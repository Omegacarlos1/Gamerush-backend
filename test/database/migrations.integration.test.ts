import { expect } from 'chai';
import type { Pool, RowDataPacket } from 'mysql2/promise';

import { createMySqlPool } from '../../src/infrastructure/database/mysql-pool.js';
import { loadMigrations } from '../../src/infrastructure/database/migrations/migration-loader.js';
import type { Migration } from '../../src/infrastructure/database/migrations/migration.js';
import {
  MigrationRunner,
  MigrationStateError,
} from '../../src/infrastructure/database/migrations/migration-runner.js';
import { seedCatalog } from '../../src/infrastructure/database/seeds/catalog-seed.js';
import { withTransaction } from '../../src/infrastructure/database/transaction.js';
import { createIntegrationDatabaseConfig } from '../helpers/database.js';

interface CountRow extends RowDataPacket {
  readonly count: number;
}

interface IdRow extends RowDataPacket {
  readonly id: number;
}

describe('versioned database migrations on the isolated database', function () {
  this.timeout(20_000);

  const config = createIntegrationDatabaseConfig();
  const safetyContext = { nodeEnv: config.nodeEnv, databaseName: config.database.name };
  let pool: Pool;
  let migrations: Migration[];
  let runner: MigrationRunner;

  before(async () => {
    pool = createMySqlPool(config);
    migrations = await loadMigrations();
    runner = new MigrationRunner(pool, migrations, safetyContext);

    const existing = await runner.status();
    const appliedCount = existing.filter((migration) => migration.state === 'applied').length;
    if (appliedCount > 0) await runner.down(appliedCount);
  });

  after(async () => {
    await pool.end();
  });

  it('reports every migration pending on a fresh schema', async () => {
    const status = await runner.status();

    expect(status).to.have.length(7);
    expect(status.every((migration) => migration.state === 'pending')).to.equal(true);
  });

  it('applies every migration and records checksums', async () => {
    const result = await runner.up();
    const status = await runner.status();

    expect(result.versions).to.deep.equal(migrations.map((migration) => migration.version));
    expect(status.every((migration) => migration.state === 'applied')).to.equal(true);
    expect(await countRows(pool, 'schema_migrations')).to.equal(7);
  });

  it('treats a repeated migration run as a no-op', async () => {
    const result = await runner.up();

    expect(result.versions).to.deep.equal([]);
    expect(await countRows(pool, 'schema_migrations')).to.equal(7);
  });

  it('rejects migration file drift after application', async () => {
    const changed = migrations.map((migration, index) =>
      index === 0 ? { ...migration, checksum: '0'.repeat(64) } : migration,
    );
    const changedRunner = new MigrationRunner(pool, changed, safetyContext);

    await expectFailure(changedRunner.status(), MigrationStateError, 'does not match local files');
  });

  it('does not record a migration whose SQL fails', async () => {
    const invalidMigration: Migration = {
      version: '9999',
      name: 'forced_failure',
      checksum: 'f'.repeat(64),
      upStatements: ['THIS IS NOT VALID SQL'],
      downStatements: ['SELECT 1'],
    };
    const invalidRunner = new MigrationRunner(
      pool,
      [...migrations, invalidMigration],
      safetyContext,
    );

    await expectFailure(invalidRunner.up());
    const [rows] = await pool.execute<CountRow[]>(
      'SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?',
      ['9999'],
    );
    expect(Number(rows[0]?.count)).to.equal(0);
  });

  it('seeds deterministic catalog fixtures repeatably', async () => {
    const first = await seedCatalog(pool, safetyContext);
    const second = await seedCatalog(pool, safetyContext);

    expect(first).to.deep.equal({
      roles: 2,
      games: 1,
      gameVersions: 1,
      characters: 3,
      progressionPolicies: 1,
      achievements: 2,
      badges: 3,
      rewardPolicies: 1,
      rewardRules: 4,
    });
    expect(second).to.deep.equal(first);
  });

  it('enforces foreign keys, checks, uniqueness, indexes, and idempotency', async () => {
    const playerRoleId = await selectId(pool, 'SELECT id FROM roles WHERE code = ?', ['player']);
    await pool.execute(
      `INSERT INTO users
        (public_id, email, username, password_hash, role_id, status, email_verified_at)
       VALUES (?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(6))`,
      [
        '50000000-0000-4000-8000-000000000001',
        'm02-player@example.test',
        'm02-player',
        'not-a-login-capable-hash',
        playerRoleId,
      ],
    );
    const userId = await selectId(pool, 'SELECT id FROM users WHERE email = ?', [
      'm02-player@example.test',
    ]);

    await expectFailure(
      pool.execute(
        `INSERT INTO users (public_id, email, username, password_hash, role_id, status)
         VALUES (?, ?, ?, ?, ?, 'active')`,
        [
          '50000000-0000-4000-8000-000000000002',
          'm02-player@example.test',
          'different-player',
          'not-a-login-capable-hash',
          playerRoleId,
        ],
      ),
    );
    await expectFailure(
      pool.execute('INSERT INTO player_profiles (user_id) VALUES (?)', [9_999_999_999]),
    );
    await expectFailure(
      pool.execute('UPDATE characters SET unlock_level = 0 WHERE slug = ?', ['starter']),
    );

    await pool.execute(
      `INSERT INTO xp_ledger
        (user_id, amount, balance_after, source_type, source_reference, idempotency_key)
       VALUES (?, 10, 10, 'gameplay', ?, ?)`,
      [userId, 'verified-score:fixture', 'xp:fixture:1'],
    );
    await expectFailure(
      pool.execute(
        `INSERT INTO xp_ledger
          (user_id, amount, balance_after, source_type, source_reference, idempotency_key)
         VALUES (?, 10, 20, 'gameplay', ?, ?)`,
        [userId, 'verified-score:fixture-2', 'xp:fixture:1'],
      ),
    );
    await expectFailure(
      pool.execute('UPDATE xp_ledger SET amount = 20 WHERE user_id = ?', [userId]),
    );
    await expectFailure(pool.execute('DELETE FROM xp_ledger WHERE user_id = ?', [userId]));

    const [indexRows] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS count
       FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = 'leaderboard_entries' AND index_name = 'idx_leaderboard_rank'`,
      [config.database.name],
    );
    expect(Number(indexRows[0]?.count)).to.be.greaterThan(0);
  });

  it('keeps append-only administrator audit history immutable', async () => {
    const userId = await selectId(pool, 'SELECT id FROM users WHERE email = ?', [
      'm02-player@example.test',
    ]);
    await pool.execute(
      `INSERT INTO admin_audit_events
        (public_id, actor_user_id, action, target_type, target_reference, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        '60000000-0000-4000-8000-000000000001',
        userId,
        'fixture.created',
        'test_fixture',
        'm02',
        'Migration acceptance test',
      ],
    );

    await expectFailure(
      pool.execute('UPDATE admin_audit_events SET reason = ? WHERE public_id = ?', [
        'changed',
        '60000000-0000-4000-8000-000000000001',
      ]),
    );
    await expectFailure(
      pool.execute('DELETE FROM admin_audit_events WHERE public_id = ?', [
        '60000000-0000-4000-8000-000000000001',
      ]),
    );
  });

  it('rolls back every DML write after a forced transaction failure', async () => {
    const email = 'rollback-proof@example.test';
    const playerRoleId = await selectId(pool, 'SELECT id FROM roles WHERE code = ?', ['player']);

    await expectFailure(
      withTransaction(pool, async (connection) => {
        await connection.execute(
          `INSERT INTO users (public_id, email, username, password_hash, role_id, status)
           VALUES (?, ?, ?, ?, ?, 'active')`,
          [
            '50000000-0000-4000-8000-000000000003',
            email,
            'rollback-proof',
            'not-a-login-capable-hash',
            playerRoleId,
          ],
        );
        throw new Error('forced transaction failure');
      }),
      Error,
      'forced transaction failure',
    );

    const [rows] = await pool.execute<CountRow[]>(
      'SELECT COUNT(*) AS count FROM users WHERE email = ?',
      [email],
    );
    expect(Number(rows[0]?.count)).to.equal(0);
  });

  it('rolls back one version and reapplies it', async () => {
    const down = await runner.down(1);
    const pending = (await runner.status()).filter((migration) => migration.state === 'pending');

    expect(down.versions).to.deep.equal(['0007']);
    expect(pending.map((migration) => migration.version)).to.deep.equal(['0007']);
    expect((await runner.up()).versions).to.deep.equal(['0007']);
  });

  it('rolls back all business tables and performs a clean re-migration', async () => {
    const down = await runner.down(migrations.length);
    expect(down.versions).to.deep.equal(
      [...migrations].reverse().map((migration) => migration.version),
    );

    const [tablesAfterDown] = await pool.execute<(RowDataPacket & { table_name: string })[]>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = ? AND table_name <> 'schema_migrations'`,
      [config.database.name],
    );
    expect(tablesAfterDown).to.deep.equal([]);

    expect((await runner.up()).versions).to.deep.equal(
      migrations.map((migration) => migration.version),
    );
    await seedCatalog(pool, safetyContext);
  });
});

async function countRows(pool: Pool, table: 'schema_migrations'): Promise<number> {
  const [rows] = await pool.query<CountRow[]>(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(rows[0]?.count);
}

async function selectId(
  pool: Pool,
  sql: string,
  parameters: readonly (string | number)[],
): Promise<number> {
  const [rows] = await pool.execute<IdRow[]>(sql, [...parameters]);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Expected fixture row was not found');
  return id;
}

async function expectFailure(
  operation: Promise<unknown>,
  expectedType?: new (...arguments_: never[]) => Error,
  message?: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await operation;
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).to.be.instanceOf(expectedType ?? Error);
  if (message !== undefined) expect((thrown as Error).message).to.include(message);
}

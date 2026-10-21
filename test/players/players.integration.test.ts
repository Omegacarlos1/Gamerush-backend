import { expect } from 'chai';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import pino from 'pino';
import request, { type Response as SupertestResponse } from 'supertest';

import { createApp } from '../../src/app.js';
import { createMySqlPool } from '../../src/infrastructure/database/mysql-pool.js';
import { loadMigrations } from '../../src/infrastructure/database/migrations/migration-loader.js';
import { MigrationRunner } from '../../src/infrastructure/database/migrations/migration-runner.js';
import { seedCatalog } from '../../src/infrastructure/database/seeds/catalog-seed.js';
import { AuthService } from '../../src/modules/auth/application/auth.service.js';
import type { VerificationDelivery } from '../../src/modules/auth/application/auth.ports.js';
import { Argon2PasswordHasher } from '../../src/modules/auth/infrastructure/argon2-password-hasher.js';
import { MySqlAuthRepository } from '../../src/modules/auth/infrastructure/mysql-auth.repository.js';
import { authCookieNames } from '../../src/modules/auth/presentation/auth.cookies.js';
import { HealthService } from '../../src/modules/health/application/health.service.js';
import { PlayerService } from '../../src/modules/players/application/player.service.js';
import { ProgressionPolicyService } from '../../src/modules/players/application/progression-policy.service.js';
import { MySqlPlayerRepository } from '../../src/modules/players/infrastructure/mysql-player.repository.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { createIntegrationDatabaseConfig } from '../helpers/database.js';

interface CountRow extends RowDataPacket {
  readonly count: number;
}

interface ProgressionRow extends RowDataPacket {
  readonly totalXp: string;
  readonly level: number;
  readonly ledgerTotal: string;
}

class CapturingVerificationDelivery implements VerificationDelivery {
  public readonly deliveries: { recipient: string; token: string; expiresAt: Date }[] = [];

  public deliver(input: { recipient: string; token: string; expiresAt: Date }): Promise<void> {
    this.deliveries.push(input);
    return Promise.resolve();
  }
}

describe('M04 player profiles and XP ledger on the isolated database', function () {
  this.timeout(60_000);

  const config = createIntegrationDatabaseConfig();
  const clock = { now: new Date('2026-10-21T12:00:00.000Z') };
  let pool: Pool;

  before(async () => {
    pool = createMySqlPool(config);
    const migrations = await loadMigrations();
    const runner = new MigrationRunner(pool, migrations, {
      nodeEnv: config.nodeEnv,
      databaseName: config.database.name,
    });
    await runner.up();
    await seedCatalog(pool, {
      nodeEnv: config.nodeEnv,
      databaseName: config.database.name,
    });
  });

  beforeEach(async () => {
    clock.now = new Date('2026-10-21T12:00:00.000Z');
    await cleanPlayerFixtures(pool);
    await pool.execute('UPDATE progression_policy_versions SET retired_at = NULL');
  });

  afterEach(async () => {
    await pool.query('DROP TRIGGER IF EXISTS trg_m04_force_profile_failure');
  });

  after(async () => {
    await cleanPlayerFixtures(pool);
    await pool.execute('UPDATE progression_policy_versions SET retired_at = NULL');
    await pool.end();
  });

  it('creates, reads, and updates only the authenticated player profile fields', async () => {
    const fixture = buildFixture(pool, clock);
    const player = await createActivePlayer(fixture, 'profile@m04.test', 'profile_player');
    const session = await signIn(fixture.app, 'profile@m04.test');

    const initial = await request(fixture.app)
      .get('/api/v1/players/me')
      .set('Cookie', session.cookies)
      .expect(200);
    expect(initial.body.data.profile).to.include({
      id: player.id,
      username: 'profile_player',
      displayName: null,
      bio: null,
      totalXp: 0,
      level: 1,
      allTimeBestScore: 0,
    });

    const updated = await request(fixture.app)
      .patch('/api/v1/players/me')
      .set('Cookie', session.cookies)
      .set('X-CSRF-Token', session.csrf)
      .send({ displayName: '  Rush Pilot  ', bio: '  Plays fair.  ' })
      .expect(200);
    expect(updated.body.data.profile).to.include({
      displayName: 'Rush Pilot',
      bio: 'Plays fair.',
      totalXp: 0,
      level: 1,
    });

    const cleared = await request(fixture.app)
      .patch('/api/v1/players/me')
      .set('Cookie', session.cookies)
      .set('X-CSRF-Token', session.csrf)
      .send({ displayName: null, bio: null })
      .expect(200);
    expect(cleared.body.data.profile).to.include({ displayName: null, bio: null });
    expect(await profileCount(pool, player.id)).to.equal(1);
  });

  it('rejects unauthenticated, non-CSRF, protected, unknown, empty, and other-player edits', async () => {
    const fixture = buildFixture(pool, clock);
    const player = await createActivePlayer(fixture, 'guard@m04.test', 'guard_player');
    const session = await signIn(fixture.app, 'guard@m04.test');

    await request(fixture.app).get('/api/v1/players/me').expect(401);
    await request(fixture.app).patch('/api/v1/players/me').send({ bio: 'No session' }).expect(401);
    await request(fixture.app)
      .patch('/api/v1/players/me')
      .set('Cookie', session.cookies)
      .send({ bio: 'No CSRF' })
      .expect(403);

    for (const body of [
      {},
      { role: 'admin' },
      { status: 'active' },
      { totalXp: 500 },
      { level: 9 },
      { score: 1000 },
      { unlocks: ['all'] },
      { userId: player.id },
      { unknown: true },
    ]) {
      const response = await request(fixture.app)
        .patch('/api/v1/players/me')
        .set('Cookie', session.cookies)
        .set('X-CSRF-Token', session.csrf)
        .send(body)
        .expect(400);
      expect(response.body.error.code).to.equal('INVALID_REQUEST');
    }

    await request(fixture.app)
      .patch(`/api/v1/players/${player.id}`)
      .set('Cookie', session.cookies)
      .set('X-CSRF-Token', session.csrf)
      .send({ bio: 'Not allowed' })
      .expect(404);
  });

  it('creates a missing profile deterministically under concurrent reads', async () => {
    const fixture = buildFixture(pool, clock);
    const player = await createActivePlayer(fixture, 'race@m04.test', 'race_player');
    const session = await signIn(fixture.app, 'race@m04.test');

    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(fixture.app).get('/api/v1/players/me').set('Cookie', session.cookies),
      ),
    );
    expect(responses.map((response) => response.status)).to.deep.equal([200, 200]);
    expect(
      new Set(responses.map((response) => response.body.data.profile.id as string)).size,
    ).to.equal(1);
    expect(await profileCount(pool, player.id)).to.equal(1);
  });

  it('loads the active database policy and applies score and level floor boundaries', async () => {
    const fixture = buildFixture(pool, clock);
    const player = await createActivePlayer(fixture, 'levels@m04.test', 'levels_player');
    const policy = await fixture.playerRepository.withTransaction((transaction) =>
      fixture.progressionPolicy.loadActive(transaction, clock.now),
    );
    expect(policy.version).to.equal('progression-v1');
    expect(fixture.progressionPolicy.xpFromValidatedScore(9, policy)).to.equal(0);
    expect(fixture.progressionPolicy.xpFromValidatedScore(10, policy)).to.equal(1);
    expect(fixture.progressionPolicy.levelFromTotalXp(0, policy)).to.equal(1);
    expect(fixture.progressionPolicy.levelFromTotalXp(499, policy)).to.equal(1);
    expect(fixture.progressionPolicy.levelFromTotalXp(500, policy)).to.equal(2);
    expect(fixture.progressionPolicy.levelFromTotalXp(1500, policy)).to.equal(4);

    const first = await award(fixture.playerService, player.id, 499, 'level-499');
    const second = await award(fixture.playerService, player.id, 1, 'level-500');
    const third = await award(fixture.playerService, player.id, 1000, 'level-1500');
    expect(first).to.include({ balanceAfter: 499, levelAfter: 1 });
    expect(second).to.include({ balanceAfter: 500, levelAfter: 2 });
    expect(third).to.include({ balanceAfter: 1500, levelAfter: 4 });
  });

  it('returns the original effect for a duplicate idempotency key and rejects payload drift', async () => {
    const fixture = buildFixture(pool, clock);
    const player = await createActivePlayer(fixture, 'idempotent@m04.test', 'idempotent_player');
    const first = await award(fixture.playerService, player.id, 250, 'same-award');
    clock.now = new Date('2026-10-21T13:00:00.000Z');
    const replay = await award(fixture.playerService, player.id, 250, 'same-award');
    expect(replay).to.deep.equal({ ...first, replayed: true });
    await expectAppError(
      award(fixture.playerService, player.id, 251, 'same-award'),
      'XP_IDEMPOTENCY_CONFLICT',
    );
    expect(await ledgerCount(pool, 'm04:same-award')).to.equal(1);
  });

  it('serializes concurrent distinct awards without losing ledger or cached totals', async () => {
    const fixture = buildFixture(pool, clock);
    const player = await createActivePlayer(fixture, 'concurrent@m04.test', 'concurrent_xp');
    await fixture.playerService.getMyProfile(player.id);

    const awards = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        award(fixture.playerService, player.id, 37, `concurrent-${index}`),
      ),
    );
    expect(awards.every((result) => !result.replayed)).to.equal(true);

    const progression = await readProgression(pool, player.id);
    expect(progression).to.deep.equal({ totalXp: 740, level: 2, ledgerTotal: 740 });
  });

  it('rolls back both ledger and cached progression after a forced persistence failure', async () => {
    const fixture = buildFixture(pool, clock);
    const player = await createActivePlayer(fixture, 'rollback@m04.test', 'rollback_player');
    await fixture.playerService.getMyProfile(player.id);
    await pool.query(
      `CREATE TRIGGER trg_m04_force_profile_failure
       BEFORE UPDATE ON player_profiles
       FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced M04 rollback'`,
    );

    await expectRejection(award(fixture.playerService, player.id, 777, 'forced-rollback'));
    expect(await ledgerCount(pool, 'm04:forced-rollback')).to.equal(0);
    expect(await readProgression(pool, player.id)).to.deep.equal({
      totalXp: 0,
      level: 1,
      ledgerTotal: 0,
    });
  });

  it('rejects untrusted and adjustment sources and exposes no client XP award route', async () => {
    const fixture = buildFixture(pool, clock);
    const player = await createActivePlayer(fixture, 'source@m04.test', 'source_player');
    const session = await signIn(fixture.app, 'source@m04.test');

    await expectAppError(
      fixture.playerService.awardXp({
        userId: player.id,
        amount: 100,
        sourceType: 'client',
        sourceReference: 'browser',
        idempotencyKey: 'm04:client-source',
      }),
      'INVALID_REQUEST',
    );
    await expectAppError(
      fixture.playerService.awardXp({
        userId: player.id,
        amount: 100,
        sourceType: 'admin_adjustment',
        sourceReference: 'unapproved',
        idempotencyKey: 'm04:unapproved-adjustment',
      }),
      'INVALID_REQUEST',
    );
    await request(fixture.app)
      .post('/api/v1/players/me/xp')
      .set('Cookie', session.cookies)
      .set('X-CSRF-Token', session.csrf)
      .send({ amount: 100 })
      .expect(404);
  });

  it('paginates XP history stably, enforces bounds, and never leaks another player', async () => {
    const fixture = buildFixture(pool, clock);
    const player = await createActivePlayer(fixture, 'history@m04.test', 'history_player');
    const other = await createActivePlayer(fixture, 'other@m04.test', 'other_player');
    const session = await signIn(fixture.app, 'history@m04.test');

    for (let index = 0; index < 5; index += 1) {
      await award(fixture.playerService, player.id, index + 1, `history-${index}`);
    }
    await award(fixture.playerService, other.id, 999, 'other-private');

    const first = await request(fixture.app)
      .get('/api/v1/players/me/xp-history?limit=2')
      .set('Cookie', session.cookies)
      .expect(200);
    expect(first.body.data.items).to.have.length(2);
    expect(first.body.pagination.nextCursor).to.be.a('string');
    expect(JSON.stringify(first.body)).not.to.include('other-private');
    expect(first.body.data.items[0]).not.to.have.property('id');
    expect(first.body.data.items[0]).not.to.have.property('metadata');

    clock.now = new Date('2026-10-21T12:00:01.000Z');
    await award(fixture.playerService, player.id, 10, 'newer-after-page-one');

    const second = await request(fixture.app)
      .get(
        `/api/v1/players/me/xp-history?limit=2&cursor=${encodeURIComponent(first.body.pagination.nextCursor)}`,
      )
      .set('Cookie', session.cookies)
      .expect(200);
    expect(second.body.data.items).to.have.length(2);
    const firstItems = first.body.data.items as { sourceReference: string }[];
    const secondItems = second.body.data.items as { sourceReference: string }[];
    const firstReferences = firstItems.map(
      (item: { sourceReference: string }) => item.sourceReference,
    );
    const secondReferences = secondItems.map(
      (item: { sourceReference: string }) => item.sourceReference,
    );
    expect(secondReferences).not.to.include.members(firstReferences);
    expect(secondReferences).not.to.include('newer-after-page-one');
    expect([...firstReferences, ...secondReferences]).not.to.include('other-private');

    await request(fixture.app)
      .get('/api/v1/players/me/xp-history?limit=101')
      .set('Cookie', session.cookies)
      .expect(400);
    await request(fixture.app)
      .get('/api/v1/players/me/xp-history?cursor=not-a-cursor')
      .set('Cookie', session.cookies)
      .expect(400);
    await request(fixture.app)
      .get(`/api/v1/players/${other.id}/xp-history`)
      .set('Cookie', session.cookies)
      .expect(404);
  });

  it('keeps existing profiles readable but blocks creation and awards without an active policy', async () => {
    const fixture = buildFixture(pool, clock);
    const existing = await createActivePlayer(fixture, 'existing@m04.test', 'existing_player');
    await fixture.playerService.getMyProfile(existing.id);
    const missing = await createActivePlayer(fixture, 'missing@m04.test', 'missing_player');
    await pool.execute('UPDATE progression_policy_versions SET retired_at = ?', [clock.now]);

    expect((await fixture.playerService.getMyProfile(existing.id)).id).to.equal(existing.id);
    await expectAppError(fixture.playerService.getMyProfile(missing.id), 'SERVICE_UNAVAILABLE');
    await expectAppError(
      award(fixture.playerService, existing.id, 10, 'no-active-policy'),
      'SERVICE_UNAVAILABLE',
    );
  });
});

function buildFixture(pool: Pool, clock: { now: Date }) {
  const delivery = new CapturingVerificationDelivery();
  const logger = pino({ level: 'silent' });
  const authService = new AuthService(
    new MySqlAuthRepository(pool),
    new Argon2PasswordHasher(),
    delivery,
    createIntegrationDatabaseConfig(),
    logger,
    () => clock.now,
  );
  const playerRepository = new MySqlPlayerRepository(pool);
  const progressionPolicy = new ProgressionPolicyService();
  const playerService = new PlayerService(playerRepository, progressionPolicy, () => clock.now);
  const healthService = new HealthService(() => Promise.resolve(), logger);
  const app = createApp({
    config: createIntegrationDatabaseConfig(),
    logger,
    healthService,
    authService,
    playerService,
  });
  return { app, delivery, playerService, playerRepository, progressionPolicy };
}

async function createActivePlayer(
  fixture: ReturnType<typeof buildFixture>,
  email: string,
  username: string,
): Promise<{ id: string }> {
  const registered = await request(fixture.app)
    .post('/api/v1/auth/register')
    .send({ email, username, password: 'StrongPassword123!' })
    .expect(201);
  const token = fixture.delivery.deliveries.at(-1)?.token;
  if (token === undefined) throw new Error('Verification token was not captured');
  await request(fixture.app).post('/api/v1/auth/verify-email').send({ token }).expect(204);
  return { id: registered.body.data.user.id as string };
}

async function signIn(app: Express, email: string): Promise<{ cookies: string; csrf: string }> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'StrongPassword123!' })
    .expect(200);
  return {
    cookies: setCookies(response)
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; '),
    csrf: cookieValue(response, authCookieNames(createIntegrationDatabaseConfig()).csrf),
  };
}

function setCookies(response: SupertestResponse): string[] {
  const header = response.headers['set-cookie'] as unknown;
  if (!Array.isArray(header) || !header.every((value) => typeof value === 'string')) {
    throw new Error('Expected Set-Cookie response headers');
  }
  return header;
}

function cookieValue(response: SupertestResponse, name: string): string {
  const cookie = setCookies(response).find((candidate) => candidate.startsWith(`${name}=`));
  const value = cookie?.split(';', 1)[0]?.slice(name.length + 1);
  if (value === undefined) throw new Error(`Cookie ${name} was not found`);
  return decodeURIComponent(value);
}

function award(service: PlayerService, userId: string, amount: number, reference: string) {
  return service.awardXp({
    userId,
    amount,
    sourceType: 'gameplay',
    sourceReference: reference,
    idempotencyKey: `m04:${reference}`,
  });
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.fail('Expected operation to reject');
  } catch (error: unknown) {
    expect(error).to.be.instanceOf(AppError);
    expect((error as AppError).code).to.equal(code);
  }
}

async function expectRejection(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    expect.fail('Expected operation to reject');
  } catch (error: unknown) {
    expect(error).to.be.instanceOf(Error);
  }
}

async function profileCount(pool: Pool, userPublicId: string): Promise<number> {
  const [rows] = await pool.execute<CountRow[]>(
    `SELECT COUNT(*) AS count FROM player_profiles p
     INNER JOIN users u ON u.id = p.user_id WHERE u.public_id = ?`,
    [userPublicId],
  );
  return Number(rows[0]?.count);
}

async function ledgerCount(pool: Pool, idempotencyKey: string): Promise<number> {
  const [rows] = await pool.execute<CountRow[]>(
    'SELECT COUNT(*) AS count FROM xp_ledger WHERE idempotency_key = ?',
    [idempotencyKey],
  );
  return Number(rows[0]?.count);
}

async function readProgression(
  pool: Pool,
  userPublicId: string,
): Promise<{ totalXp: number; level: number; ledgerTotal: number }> {
  const [rows] = await pool.execute<ProgressionRow[]>(
    `SELECT CAST(p.total_xp AS CHAR) AS totalXp, p.level,
            CAST(COALESCE(SUM(x.amount), 0) AS CHAR) AS ledgerTotal
     FROM users u
     INNER JOIN player_profiles p ON p.user_id = u.id
     LEFT JOIN xp_ledger x ON x.user_id = u.id
     WHERE u.public_id = ?
     GROUP BY p.user_id, p.total_xp, p.level`,
    [userPublicId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('Progression row was not found');
  return { totalXp: Number(row.totalXp), level: row.level, ledgerTotal: Number(row.ledgerTotal) };
}

async function cleanPlayerFixtures(pool: Pool): Promise<void> {
  await pool.query('DROP TRIGGER IF EXISTS trg_m04_force_profile_failure');
  await pool.query('DROP TRIGGER IF EXISTS trg_xp_ledger_prevent_update');
  await pool.query('DROP TRIGGER IF EXISTS trg_xp_ledger_prevent_delete');
  try {
    await pool.execute(
      `DELETE x FROM xp_ledger x INNER JOIN users u ON u.id = x.user_id
       WHERE u.email LIKE '%@m04.test'`,
    );
    await pool.execute(
      `DELETE s FROM auth_sessions s INNER JOIN users u ON u.id = s.user_id
       WHERE u.email LIKE '%@m04.test'`,
    );
    await pool.execute(
      `DELETE t FROM auth_tokens t INNER JOIN users u ON u.id = t.user_id
       WHERE u.email LIKE '%@m04.test'`,
    );
    await pool.execute(`DELETE FROM users WHERE email LIKE '%@m04.test'`);
  } finally {
    await pool.query(
      `CREATE TRIGGER trg_xp_ledger_prevent_update
       BEFORE UPDATE ON xp_ledger
       FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'xp_ledger is append-only'`,
    );
    await pool.query(
      `CREATE TRIGGER trg_xp_ledger_prevent_delete
       BEFORE DELETE ON xp_ledger
       FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'xp_ledger is append-only'`,
    );
  }
}

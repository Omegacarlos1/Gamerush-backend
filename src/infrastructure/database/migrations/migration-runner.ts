import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

import { assertSafeDatabaseOperation } from '../database-safety.js';
import type {
  DatabaseSafetyContext,
  Migration,
  MigrationResult,
  MigrationStatus,
} from './migration.js';

const migrationLockName = 'playrush_schema_migrations';

interface AppliedMigrationRow extends RowDataPacket {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly applied_at: Date;
}

interface LockRow extends RowDataPacket {
  readonly acquired: number | null;
}

export class MigrationStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MigrationStateError';
  }
}

export class MigrationRunner {
  public constructor(
    private readonly pool: Pool,
    private readonly migrations: readonly Migration[],
    private readonly safetyContext: DatabaseSafetyContext,
  ) {}

  public async status(): Promise<MigrationStatus[]> {
    const connection = await this.pool.getConnection();
    try {
      await this.ensureHistoryTable(connection);
      return await this.readStatus(connection);
    } finally {
      connection.release();
    }
  }

  public async up(): Promise<MigrationResult> {
    return await this.withMigrationLock(async (connection) => {
      await this.ensureHistoryTable(connection);
      const status = await this.readStatus(connection);
      const pendingVersions = new Set(
        status.filter((item) => item.state === 'pending').map((item) => item.version),
      );
      const applied: string[] = [];

      for (const migration of this.migrations) {
        if (!pendingVersions.has(migration.version)) continue;
        for (const statement of migration.upStatements) await connection.query(statement);
        await connection.execute(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)',
          [migration.version, migration.name, migration.checksum],
        );
        applied.push(migration.version);
      }

      return { direction: 'up', versions: applied };
    });
  }

  public async down(steps = 1): Promise<MigrationResult> {
    if (!Number.isSafeInteger(steps) || steps < 1) {
      throw new MigrationStateError('Rollback steps must be a positive integer');
    }
    assertSafeDatabaseOperation('rollback', this.safetyContext);

    return await this.withMigrationLock(async (connection) => {
      await this.ensureHistoryTable(connection);
      const status = await this.readStatus(connection);
      const appliedVersions = status
        .filter((item) => item.state === 'applied')
        .map((item) => item.version)
        .sort((left, right) => right.localeCompare(left))
        .slice(0, steps);
      const rolledBack: string[] = [];

      for (const version of appliedVersions) {
        const migration = this.migrations.find((item) => item.version === version);
        if (migration === undefined) {
          throw new MigrationStateError(`Applied migration ${version} has no local definition`);
        }
        for (const statement of migration.downStatements) await connection.query(statement);
        await connection.execute('DELETE FROM schema_migrations WHERE version = ?', [version]);
        rolledBack.push(version);
      }

      return { direction: 'down', versions: rolledBack };
    });
  }

  private async readStatus(connection: PoolConnection): Promise<MigrationStatus[]> {
    const [rows] = await connection.query<AppliedMigrationRow[]>(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
    );
    const appliedByVersion = new Map(rows.map((row) => [row.version, row]));

    for (const row of rows) {
      const local = this.migrations.find((migration) => migration.version === row.version);
      if (local === undefined) {
        throw new MigrationStateError(`Applied migration ${row.version} has no local definition`);
      }
      if (local.checksum !== row.checksum || local.name !== row.name) {
        throw new MigrationStateError(
          `Applied migration ${row.version} does not match local files`,
        );
      }
    }

    return this.migrations.map((migration) => {
      const applied = appliedByVersion.get(migration.version);
      return {
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
        state: applied === undefined ? 'pending' : 'applied',
        appliedAt: applied?.applied_at ?? null,
      };
    });
  }

  private async ensureHistoryTable(connection: PoolConnection): Promise<void> {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        name VARCHAR(191) NOT NULL,
        checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (version)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  private async withMigrationLock<T>(
    operation: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    let acquired = false;
    try {
      const [rows] = await connection.execute<LockRow[]>('SELECT GET_LOCK(?, 10) AS acquired', [
        migrationLockName,
      ]);
      acquired = rows[0]?.acquired === 1;
      if (!acquired) throw new MigrationStateError('Could not acquire the migration lock');
      return await operation(connection);
    } finally {
      if (acquired) await connection.execute('SELECT RELEASE_LOCK(?)', [migrationLockName]);
      connection.release();
    }
  }
}

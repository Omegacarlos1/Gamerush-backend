import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { withTransaction } from '../../../infrastructure/database/transaction.js';
import {
  DuplicateXpIdempotencyError,
  type NewXpLedgerEntry,
  type PlayerRepository,
  type PlayerTransaction,
  type ProfilePatch,
  type XpHistoryCursor,
} from '../application/player.ports.js';
import type {
  PlayerProfileRecord,
  ProgressionPolicyRecord,
  XpHistoryRecord,
  XpLedgerRecord,
} from '../domain/player.types.js';

interface ProfileRow extends RowDataPacket {
  readonly userDatabaseId: number;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string | null;
  readonly bio: string | null;
  readonly totalXp: string;
  readonly level: number;
  readonly allTimeBestScore: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface PolicyRow extends RowDataPacket {
  readonly version: string;
  readonly scorePointsPerXp: number;
  readonly xpPerLevel: number;
  readonly startingLevel: number;
  readonly roundingMode: string;
}

interface LedgerRow extends RowDataPacket {
  readonly userId: string;
  readonly amount: string;
  readonly balanceAfter: string;
  readonly sourceType: string;
  readonly sourceReference: string;
  readonly idempotencyKey: string;
  readonly metadata: unknown;
  readonly createdAt: Date;
}

interface HistoryRow extends RowDataPacket {
  readonly amount: string;
  readonly balanceAfter: string;
  readonly sourceType: string;
  readonly sourceReference: string;
  readonly cursorCreatedAt: string;
  readonly cursorId: string;
}

const profileSelect = `
  SELECT u.id AS userDatabaseId, u.public_id AS userId, u.username,
         p.display_name AS displayName, p.bio,
         CAST(p.total_xp AS CHAR) AS totalXp, p.level,
         CAST(p.all_time_best_score AS CHAR) AS allTimeBestScore,
         p.created_at AS createdAt, p.updated_at AS updatedAt
  FROM player_profiles p
  INNER JOIN users u ON u.id = p.user_id`;

export class MySqlPlayerRepository implements PlayerRepository {
  public constructor(private readonly pool: Pool) {}

  public async withTransaction<T>(
    operation: (transaction: PlayerTransaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await withTransaction(this.pool, (connection) =>
          operation(new MySqlPlayerTransaction(connection)),
        );
      } catch (error: unknown) {
        if (!isDeadlockError(error) || attempt === 3) throw error;
      }
    }
    throw new Error('Transaction retry limit reached');
  }

  public async listXpHistory(
    userPublicId: string,
    cursor: XpHistoryCursor | null,
    limit: number,
  ): Promise<readonly XpHistoryRecord[]> {
    const cursorClause =
      cursor === null
        ? ''
        : `AND (x.created_at < ? OR (x.created_at = ? AND x.id < CAST(? AS UNSIGNED)))`;
    const parameters =
      cursor === null
        ? [userPublicId, limit]
        : [userPublicId, cursor.createdAt, cursor.createdAt, cursor.id, limit];
    const [rows] = await this.pool.execute<HistoryRow[]>(
      `SELECT CAST(x.amount AS CHAR) AS amount,
              CAST(x.balance_after AS CHAR) AS balanceAfter,
              x.source_type AS sourceType, x.source_reference AS sourceReference,
              DATE_FORMAT(x.created_at, '%Y-%m-%d %H:%i:%s.%f') AS cursorCreatedAt,
              CAST(x.id AS CHAR) AS cursorId
       FROM xp_ledger x
       INNER JOIN users u ON u.id = x.user_id
       WHERE u.public_id = ? ${cursorClause}
       ORDER BY x.created_at DESC, x.id DESC
       LIMIT ?`,
      parameters,
    );
    return rows.map((row) => ({
      amount: parseSafeInteger(row.amount, 'XP amount'),
      balanceAfter: parseSafeInteger(row.balanceAfter, 'XP balance'),
      sourceType: row.sourceType,
      sourceReference: row.sourceReference,
      createdAt: `${row.cursorCreatedAt.replace(' ', 'T')}Z`,
      cursorCreatedAt: row.cursorCreatedAt,
      cursorId: row.cursorId,
    }));
  }
}

class MySqlPlayerTransaction implements PlayerTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  public async findProfile(userPublicId: string): Promise<PlayerProfileRecord | null> {
    const [rows] = await this.connection.execute<ProfileRow[]>(
      `${profileSelect} WHERE u.public_id = ? LIMIT 1`,
      [userPublicId],
    );
    return rows[0] === undefined ? null : mapProfile(rows[0]);
  }

  public async ensureProfile(userPublicId: string, startingLevel: number): Promise<void> {
    await this.connection.execute(
      `INSERT INTO player_profiles (user_id, level)
       SELECT id, ? FROM users WHERE public_id = ? AND status = 'active'
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
      [startingLevel, userPublicId],
    );
  }

  public async lockProfile(userPublicId: string): Promise<PlayerProfileRecord | null> {
    const [rows] = await this.connection.execute<ProfileRow[]>(
      `${profileSelect} WHERE u.public_id = ? LIMIT 1 FOR UPDATE`,
      [userPublicId],
    );
    return rows[0] === undefined ? null : mapProfile(rows[0]);
  }

  public async updateProfile(userDatabaseId: number, patch: ProfilePatch): Promise<void> {
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];
    if (Object.hasOwn(patch, 'displayName')) {
      assignments.push('display_name = ?');
      values.push(patch.displayName ?? null);
    }
    if (Object.hasOwn(patch, 'bio')) {
      assignments.push('bio = ?');
      values.push(patch.bio ?? null);
    }
    if (assignments.length === 0) return;
    values.push(userDatabaseId);
    await this.connection.execute(
      `UPDATE player_profiles SET ${assignments.join(', ')} WHERE user_id = ?`,
      values,
    );
  }

  public async findActiveProgressionPolicy(at: Date): Promise<ProgressionPolicyRecord | null> {
    const [rows] = await this.connection.execute<PolicyRow[]>(
      `SELECT version, score_points_per_xp AS scorePointsPerXp,
              xp_per_level AS xpPerLevel, starting_level AS startingLevel,
              rounding_mode AS roundingMode
       FROM progression_policy_versions
       WHERE effective_at <= ? AND (retired_at IS NULL OR retired_at > ?)
       ORDER BY effective_at DESC, id DESC
       LIMIT 1`,
      [at, at],
    );
    return rows[0] ?? null;
  }

  public async findXpLedgerEntry(idempotencyKey: string): Promise<XpLedgerRecord | null> {
    const [rows] = await this.connection.execute<LedgerRow[]>(
      `SELECT u.public_id AS userId, CAST(x.amount AS CHAR) AS amount,
              CAST(x.balance_after AS CHAR) AS balanceAfter,
              x.source_type AS sourceType, x.source_reference AS sourceReference,
              x.idempotency_key AS idempotencyKey, x.metadata,
              x.created_at AS createdAt
       FROM xp_ledger x
       INNER JOIN users u ON u.id = x.user_id
       WHERE x.idempotency_key = ? LIMIT 1`,
      [idempotencyKey],
    );
    const row = rows[0];
    if (row === undefined) return null;
    const metadata = parseLedgerMetadata(row.metadata);
    return {
      userId: row.userId,
      amount: parseSafeInteger(row.amount, 'XP amount'),
      balanceAfter: parseSafeInteger(row.balanceAfter, 'XP balance'),
      sourceType: row.sourceType,
      sourceReference: row.sourceReference,
      idempotencyKey: row.idempotencyKey,
      policyVersion: metadata.policyVersion,
      levelAfter: metadata.levelAfter,
      createdAt: row.createdAt,
    };
  }

  public async insertXpLedgerEntry(input: NewXpLedgerEntry): Promise<void> {
    try {
      await this.connection.execute<ResultSetHeader>(
        `INSERT INTO xp_ledger
          (user_id, amount, balance_after, source_type, source_reference,
           idempotency_key, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.userDatabaseId,
          input.amount,
          input.balanceAfter,
          input.sourceType,
          input.sourceReference,
          input.idempotencyKey,
          JSON.stringify({
            progressionPolicyVersion: input.policyVersion,
            levelAfter: input.levelAfter,
          }),
          input.createdAt,
        ],
      );
    } catch (error: unknown) {
      if (isDuplicateEntryError(error)) throw new DuplicateXpIdempotencyError();
      throw error;
    }
  }

  public async updateProgression(
    userDatabaseId: number,
    totalXp: number,
    level: number,
  ): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      'UPDATE player_profiles SET total_xp = ?, level = ? WHERE user_id = ?',
      [totalXp, level, userDatabaseId],
    );
    if (result.affectedRows !== 1) throw new Error('Player progression update failed');
  }
}

function mapProfile(row: ProfileRow): PlayerProfileRecord {
  return {
    userDatabaseId: row.userDatabaseId,
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    bio: row.bio,
    totalXp: parseSafeInteger(row.totalXp, 'Player total XP'),
    level: row.level,
    allTimeBestScore: parseSafeInteger(row.allTimeBestScore, 'Player best score'),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseSafeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} exceeds the safe integer range`);
  return parsed;
}

function parseLedgerMetadata(value: unknown): { policyVersion: string; levelAfter: number } {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('progressionPolicyVersion' in parsed) ||
    typeof parsed.progressionPolicyVersion !== 'string' ||
    !('levelAfter' in parsed) ||
    typeof parsed.levelAfter !== 'number' ||
    !Number.isSafeInteger(parsed.levelAfter) ||
    parsed.levelAfter < 1
  ) {
    throw new Error('XP ledger progression metadata is invalid');
  }
  return { policyVersion: parsed.progressionPolicyVersion, levelAfter: parsed.levelAfter };
}

function isDuplicateEntryError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY'
  );
}

function isDeadlockError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ER_LOCK_DEADLOCK'
  );
}

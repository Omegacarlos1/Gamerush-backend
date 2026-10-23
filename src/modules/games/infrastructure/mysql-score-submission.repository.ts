import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { withTransaction } from '../../../infrastructure/database/transaction.js';
import type { ProgressionPolicyRecord } from '../../players/domain/player.types.js';
import type {
  LockedProgressionProfile,
  NewScoreSubmission,
  ScorePersistenceStage,
  ScoreSubmissionRecord,
  ScoreSubmissionRepository,
  ScoreSubmissionStatus,
  ScoreSubmissionTransaction,
} from '../application/score-submission.ports.js';
import type {
  PublicScoreRejectionCode,
  RunnerInputEvent,
  VerifiableGameSession,
  VerifiedScoreResult,
} from '../application/score-verification.ports.js';
import type { GameSessionMode, GameSessionStatus } from '../domain/game.types.js';

interface SessionRow extends RowDataPacket {
  readonly databaseId: number;
  readonly userDatabaseId: number;
  readonly gameDatabaseId: number;
  readonly publicId: string;
  readonly ownerId: string;
  readonly gameId: string;
  readonly gameVersionId: string;
  readonly rulesVersion: string;
  readonly scoringRules: unknown;
  readonly maxSessionSeconds: number;
  readonly mode: GameSessionMode;
  readonly status: GameSessionStatus;
  readonly seedHash: string;
  readonly nonceHash: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
}

interface SubmissionRow extends RowDataPacket {
  readonly databaseId: number;
  readonly publicId: string;
  readonly sessionDatabaseId: number;
  readonly sessionId: string;
  readonly ownerId: string;
  readonly requestDigest: string;
  readonly status: string;
  readonly rejectionCode: string | null;
  readonly submittedAt: Date;
  readonly processedAt: Date | null;
  readonly verifiedMetres: string | null;
  readonly verifiedCoins: number | null;
  readonly score: string | null;
  readonly finishedAt: Date | null;
  readonly xpAwarded: string | null;
}

interface PolicyRow extends RowDataPacket {
  readonly version: string;
  readonly scorePointsPerXp: number;
  readonly xpPerLevel: number;
  readonly startingLevel: number;
  readonly roundingMode: string;
}

interface ProfileRow extends RowDataPacket {
  readonly userDatabaseId: number;
  readonly totalXp: string;
}

const sessionSelect = `
  SELECT s.id AS databaseId, s.user_id AS userDatabaseId, g.id AS gameDatabaseId,
         s.public_id AS publicId, u.public_id AS ownerId, g.public_id AS gameId,
         v.public_id AS gameVersionId, v.rules_version AS rulesVersion,
         v.scoring_rules AS scoringRules, v.max_session_seconds AS maxSessionSeconds,
         s.mode, s.status, s.seed_hash AS seedHash, s.nonce_hash AS nonceHash,
         s.started_at AS startedAt, s.expires_at AS expiresAt
  FROM game_sessions s
  INNER JOIN users u ON u.id = s.user_id
  INNER JOIN game_versions v ON v.id = s.game_version_id
  INNER JOIN games g ON g.id = v.game_id`;

const submissionSelect = `
  SELECT ss.id AS databaseId, ss.public_id AS publicId,
         ss.game_session_id AS sessionDatabaseId, s.public_id AS sessionId,
         u.public_id AS ownerId, ss.replay_digest AS requestDigest,
         ss.status, ss.rejection_code AS rejectionCode,
         ss.submitted_at AS submittedAt, ss.processed_at AS processedAt,
         CAST(vs.verified_metres AS CHAR) AS verifiedMetres,
         vs.verified_coins AS verifiedCoins, CAST(vs.score AS CHAR) AS score,
         vs.finished_at AS finishedAt, CAST(x.amount AS CHAR) AS xpAwarded
  FROM score_submissions ss
  INNER JOIN game_sessions s ON s.id = ss.game_session_id
  INNER JOIN users u ON u.id = s.user_id
  LEFT JOIN verified_scores vs ON vs.score_submission_id = ss.id
  LEFT JOIN xp_ledger x ON x.idempotency_key = CONCAT('gameplay:', s.public_id)`;

export class MySqlScoreSubmissionRepository implements ScoreSubmissionRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly failureInjector?: (stage: ScorePersistenceStage) => void,
  ) {}

  public async withTransaction<T>(
    operation: (transaction: ScoreSubmissionTransaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await withTransaction(this.pool, (connection) =>
          operation(new MySqlScoreSubmissionTransaction(connection, this.failureInjector)),
        );
      } catch (error: unknown) {
        if (!isDeadlockError(error) || attempt === 3) throw error;
      }
    }
    throw new Error('Transaction retry limit reached');
  }

  public async findOwnedSubmission(
    ownerId: string,
    submissionId: string,
  ): Promise<ScoreSubmissionRecord | null> {
    const [rows] = await this.pool.execute<SubmissionRow[]>(
      `${submissionSelect} WHERE u.public_id = ? AND ss.public_id = ? LIMIT 1`,
      [ownerId, submissionId],
    );
    return rows[0] === undefined ? null : mapSubmission(rows[0]);
  }
}

class MySqlScoreSubmissionTransaction implements ScoreSubmissionTransaction {
  public constructor(
    private readonly connection: PoolConnection,
    private readonly failureInjector?: (stage: ScorePersistenceStage) => void,
  ) {}

  public async lockOwnedSession(
    ownerId: string,
    sessionId: string,
  ): Promise<VerifiableGameSession | null> {
    const [rows] = await this.connection.execute<SessionRow[]>(
      `${sessionSelect}
       WHERE u.public_id = ? AND s.public_id = ?
       LIMIT 1 FOR UPDATE`,
      [ownerId, sessionId],
    );
    return rows[0] === undefined ? null : mapSession(rows[0]);
  }

  public async findSubmissionByIdempotency(
    idempotencyKey: string,
  ): Promise<ScoreSubmissionRecord | null> {
    const [rows] = await this.connection.execute<SubmissionRow[]>(
      `${submissionSelect} WHERE ss.idempotency_key = ? LIMIT 1`,
      [idempotencyKey],
    );
    return rows[0] === undefined ? null : mapSubmission(rows[0]);
  }

  public async insertSubmission(input: NewScoreSubmission): Promise<number> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO score_submissions
        (public_id, game_session_id, idempotency_key, claimed_score, claimed_metres,
         claimed_coins, status, replay_digest, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        input.publicId,
        input.sessionDatabaseId,
        input.idempotencyKey,
        input.claimedScore,
        input.claimedMetres,
        input.claimedCoins,
        input.requestDigest,
        input.submittedAt,
      ],
    );
    this.failureInjector?.('submission');
    return result.insertId;
  }

  public async insertEvents(
    sessionDatabaseId: number,
    events: readonly RunnerInputEvent[],
  ): Promise<void> {
    for (const event of events) {
      await this.connection.execute(
        `INSERT INTO game_session_events
          (game_session_id, sequence_number, simulation_tick, event_type, event_payload)
         VALUES (?, ?, ?, ?, ?)`,
        [sessionDatabaseId, event.sequence, event.tick, event.type, JSON.stringify(event.payload)],
      );
    }
    this.failureInjector?.('events');
  }

  public async transitionSession(input: {
    readonly sessionDatabaseId: number;
    readonly from: 'active' | 'submitted';
    readonly to: 'submitted' | 'accepted' | 'rejected' | 'expired';
    readonly finishedAt: Date | null;
  }): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `UPDATE game_sessions SET status = ?, finished_at = ? WHERE id = ? AND status = ?`,
      [input.to, input.finishedAt, input.sessionDatabaseId, input.from],
    );
    if (result.affectedRows !== 1) throw new Error('Game session transition failed');
  }

  public async rejectSubmission(
    submissionDatabaseId: number,
    rejectionCode: PublicScoreRejectionCode,
    processedAt: Date,
  ): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `UPDATE score_submissions
       SET status = 'rejected', rejection_code = ?, processed_at = ?
       WHERE id = ? AND status = 'pending'`,
      [rejectionCode, processedAt, submissionDatabaseId],
    );
    if (result.affectedRows !== 1) throw new Error('Score submission rejection failed');
  }

  public async insertVerifiedScore(input: {
    readonly publicId: string;
    readonly submissionDatabaseId: number;
    readonly session: VerifiableGameSession;
    readonly result: VerifiedScoreResult;
    readonly verifiedAt: Date;
  }): Promise<void> {
    await this.connection.execute<ResultSetHeader>(
      `INSERT INTO verified_scores
        (public_id, score_submission_id, game_session_id, user_id, game_id,
         verified_metres, verified_coins, score, finished_at, verified_at, is_disqualified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        input.publicId,
        input.submissionDatabaseId,
        input.session.databaseId,
        input.session.userDatabaseId,
        input.session.gameDatabaseId,
        input.result.metres,
        input.result.coins,
        input.result.score,
        input.result.finishedAt,
        input.verifiedAt,
      ],
    );
    this.failureInjector?.('verified-score');
  }

  public async acceptSubmission(submissionDatabaseId: number, processedAt: Date): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `UPDATE score_submissions
       SET status = 'accepted', rejection_code = NULL, processed_at = ?
       WHERE id = ? AND status = 'pending'`,
      [processedAt, submissionDatabaseId],
    );
    if (result.affectedRows !== 1) throw new Error('Score submission acceptance failed');
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

  public async ensureAndLockProfile(
    ownerId: string,
    startingLevel: number,
  ): Promise<LockedProgressionProfile | null> {
    await this.connection.execute(
      `INSERT INTO player_profiles (user_id, level)
       SELECT id, ? FROM users
       WHERE public_id = ? AND status = 'active' AND email_verified_at IS NOT NULL
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
      [startingLevel, ownerId],
    );
    const [rows] = await this.connection.execute<ProfileRow[]>(
      `SELECT p.user_id AS userDatabaseId, CAST(p.total_xp AS CHAR) AS totalXp
       FROM player_profiles p
       INNER JOIN users u ON u.id = p.user_id
       WHERE u.public_id = ? LIMIT 1 FOR UPDATE`,
      [ownerId],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : { userDatabaseId: row.userDatabaseId, totalXp: parseSafeInteger(row.totalXp, 'XP') };
  }

  public async insertGameplayXp(input: {
    readonly profile: LockedProgressionProfile;
    readonly amount: number;
    readonly balanceAfter: number;
    readonly levelAfter: number;
    readonly sourceReference: string;
    readonly idempotencyKey: string;
    readonly policyVersion: string;
    readonly createdAt: Date;
  }): Promise<void> {
    await this.connection.execute<ResultSetHeader>(
      `INSERT INTO xp_ledger
        (user_id, amount, balance_after, source_type, source_reference,
         idempotency_key, metadata, created_at)
       VALUES (?, ?, ?, 'gameplay', ?, ?, ?, ?)`,
      [
        input.profile.userDatabaseId,
        input.amount,
        input.balanceAfter,
        input.sourceReference,
        input.idempotencyKey,
        JSON.stringify({
          progressionPolicyVersion: input.policyVersion,
          levelAfter: input.levelAfter,
        }),
        input.createdAt,
      ],
    );
    this.failureInjector?.('xp-ledger');
  }

  public async updateProgression(
    userDatabaseId: number,
    totalXp: number,
    level: number,
  ): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `UPDATE player_profiles SET total_xp = ?, level = ? WHERE user_id = ?`,
      [totalXp, level, userDatabaseId],
    );
    if (result.affectedRows !== 1) throw new Error('Player progression update failed');
    this.failureInjector?.('profile-update');
  }
}

function mapSession(row: SessionRow): VerifiableGameSession {
  const rules =
    typeof row.scoringRules === 'string'
      ? (JSON.parse(row.scoringRules) as unknown)
      : row.scoringRules;
  if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
    throw new Error('Game scoring rules are invalid');
  }
  return {
    databaseId: row.databaseId,
    userDatabaseId: row.userDatabaseId,
    gameDatabaseId: row.gameDatabaseId,
    id: row.publicId,
    ownerId: row.ownerId,
    gameId: row.gameId,
    gameVersionId: row.gameVersionId,
    rulesVersion: row.rulesVersion,
    scoringRules: rules as Readonly<Record<string, unknown>>,
    maxSessionSeconds: row.maxSessionSeconds,
    mode: row.mode,
    status: row.status,
    seedHash: row.seedHash,
    nonceHash: row.nonceHash,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
  };
}

function mapSubmission(row: SubmissionRow): ScoreSubmissionRecord {
  const status = parseSubmissionStatus(row.status);
  const rejectionCode = parseRejectionCode(row.rejectionCode);
  return {
    databaseId: row.databaseId,
    id: row.publicId,
    sessionDatabaseId: row.sessionDatabaseId,
    sessionId: row.sessionId,
    ownerId: row.ownerId,
    requestDigest: row.requestDigest,
    status,
    rejectionCode,
    submittedAt: row.submittedAt,
    processedAt: row.processedAt,
    result: mapVerifiedResult(row),
  };
}

function mapVerifiedResult(
  row: SubmissionRow,
): (VerifiedScoreResult & { readonly xpAwarded: number }) | null {
  if (
    row.verifiedMetres === null ||
    row.verifiedCoins === null ||
    row.score === null ||
    row.finishedAt === null
  ) {
    return null;
  }
  return {
    metres: parseSafeInteger(row.verifiedMetres, 'Verified metres'),
    coins: row.verifiedCoins,
    score: parseSafeInteger(row.score, 'Verified score'),
    finishedAt: row.finishedAt,
    xpAwarded: row.xpAwarded === null ? 0 : parseSafeInteger(row.xpAwarded, 'Gameplay XP'),
  };
}

function parseSubmissionStatus(value: string): ScoreSubmissionStatus {
  if (value === 'pending' || value === 'accepted' || value === 'rejected') return value;
  throw new Error('Unsupported score submission status');
}

function parseRejectionCode(value: string | null): PublicScoreRejectionCode | null {
  if (value === null) return null;
  if (
    value === 'CREDENTIAL_MISMATCH' ||
    value === 'VERSION_MISMATCH' ||
    value === 'REPLAY_INVALID' ||
    value === 'CLAIM_MISMATCH'
  ) {
    return value;
  }
  throw new Error('Unsupported score rejection code');
}

function parseSafeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} exceeds the safe integer range`);
  return parsed;
}

function isDeadlockError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ER_LOCK_DEADLOCK'
  );
}

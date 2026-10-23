import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { withTransaction } from '../../../infrastructure/database/transaction.js';
import type { GameRepository, GameTransaction, NewGameSession } from '../application/game.ports.js';
import type {
  GameSessionMode,
  GameSessionRecord,
  GameSessionStatus,
  PublicGameCharacter,
  PublishedGame,
  PublishedGameVersion,
} from '../domain/game.types.js';

interface GameRow extends RowDataPacket {
  readonly databaseId: number;
  readonly publicId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly versionDatabaseId: number;
  readonly versionPublicId: string;
  readonly versionNumber: string;
  readonly rulesVersion: string;
  readonly scoringRules: unknown;
  readonly maxSessionSeconds: number;
  readonly publishedAt: Date;
  readonly characterPublicId: string | null;
  readonly characterSlug: string | null;
  readonly characterName: string | null;
  readonly characterUnlockLevel: number | null;
}

interface IdRow extends RowDataPacket {
  readonly id: number;
}

interface SessionRow extends RowDataPacket {
  readonly databaseId: number;
  readonly publicId: string;
  readonly userPublicId: string;
  readonly gamePublicId: string;
  readonly gameSlug: string;
  readonly gameName: string;
  readonly versionDatabaseId: number;
  readonly versionPublicId: string;
  readonly versionNumber: string;
  readonly rulesVersion: string;
  readonly scoringRules: unknown;
  readonly maxSessionSeconds: number;
  readonly publishedAt: Date;
  readonly mode: GameSessionMode;
  readonly status: GameSessionStatus;
  readonly seedHash: string;
  readonly nonceHash: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly finishedAt: Date | null;
}

const gameSelect = `
  SELECT g.id AS databaseId, g.public_id AS publicId, g.slug, g.name, g.description,
         v.id AS versionDatabaseId, v.public_id AS versionPublicId,
         v.version_number AS versionNumber, v.rules_version AS rulesVersion,
         v.scoring_rules AS scoringRules, v.max_session_seconds AS maxSessionSeconds,
         v.published_at AS publishedAt,
         c.public_id AS characterPublicId, c.slug AS characterSlug,
         c.name AS characterName, c.unlock_level AS characterUnlockLevel
  FROM games g
  INNER JOIN game_versions v ON v.id = g.active_version_id AND v.game_id = g.id
  LEFT JOIN characters c ON c.game_id = g.id AND c.status = 'active'
  WHERE g.status = 'active' AND v.status = 'published' AND v.published_at IS NOT NULL`;

const sessionSelect = `
  SELECT s.id AS databaseId, s.public_id AS publicId, u.public_id AS userPublicId,
         g.public_id AS gamePublicId, g.slug AS gameSlug, g.name AS gameName,
         v.id AS versionDatabaseId, v.public_id AS versionPublicId,
         v.version_number AS versionNumber, v.rules_version AS rulesVersion,
         v.scoring_rules AS scoringRules, v.max_session_seconds AS maxSessionSeconds,
         v.published_at AS publishedAt, s.mode, s.status,
         s.seed_hash AS seedHash, s.nonce_hash AS nonceHash,
         s.started_at AS startedAt, s.expires_at AS expiresAt,
         s.finished_at AS finishedAt
  FROM game_sessions s
  INNER JOIN users u ON u.id = s.user_id
  INNER JOIN game_versions v ON v.id = s.game_version_id
  INNER JOIN games g ON g.id = v.game_id`;

export class MySqlGameRepository implements GameRepository {
  public constructor(private readonly pool: Pool) {}

  public async listPublishedGames(): Promise<readonly PublishedGame[]> {
    const [rows] = await this.pool.execute<GameRow[]>(
      `${gameSelect} ORDER BY g.name, g.id, c.unlock_level, c.id`,
    );
    return mapGames(rows);
  }

  public async findPublishedGame(gamePublicId: string): Promise<PublishedGame | null> {
    const [rows] = await this.pool.execute<GameRow[]>(
      `${gameSelect} AND g.public_id = ? ORDER BY c.unlock_level, c.id`,
      [gamePublicId],
    );
    return mapGames(rows)[0] ?? null;
  }

  public async withTransaction<T>(
    operation: (transaction: GameTransaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await withTransaction(this.pool, (connection) =>
          operation(new MySqlGameTransaction(connection)),
        );
      } catch (error: unknown) {
        if (!isDeadlockError(error) || attempt === 3) throw error;
      }
    }
    throw new Error('Transaction retry limit reached');
  }
}

class MySqlGameTransaction implements GameTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  public async findPublishedGameForUpdate(gamePublicId: string): Promise<PublishedGame | null> {
    const [rows] = await this.connection.execute<GameRow[]>(
      `${gameSelect} AND g.public_id = ? ORDER BY c.unlock_level, c.id FOR UPDATE`,
      [gamePublicId],
    );
    return mapGames(rows)[0] ?? null;
  }

  public async lockActiveUser(userPublicId: string): Promise<number | null> {
    const [rows] = await this.connection.execute<IdRow[]>(
      `SELECT id FROM users
       WHERE public_id = ? AND status = 'active' AND email_verified_at IS NOT NULL
       LIMIT 1 FOR UPDATE`,
      [userPublicId],
    );
    return rows[0]?.id ?? null;
  }

  public async expireOpenSessions(
    userDatabaseId: number,
    gameDatabaseId: number,
    mode: GameSessionMode,
    at: Date,
  ): Promise<void> {
    await this.connection.execute(
      `UPDATE game_sessions s
       INNER JOIN game_versions v ON v.id = s.game_version_id
       SET s.status = 'expired'
       WHERE s.user_id = ? AND v.game_id = ? AND s.mode = ?
         AND s.status IN ('issued', 'active') AND s.expires_at <= ?`,
      [userDatabaseId, gameDatabaseId, mode, at],
    );
  }

  public async findOpenSession(
    userDatabaseId: number,
    gameDatabaseId: number,
    mode: GameSessionMode,
  ): Promise<GameSessionRecord | null> {
    const [rows] = await this.connection.execute<SessionRow[]>(
      `${sessionSelect}
       WHERE s.user_id = ? AND v.game_id = ? AND s.mode = ?
         AND s.status IN ('issued', 'active', 'submitted')
       ORDER BY s.id DESC LIMIT 1`,
      [userDatabaseId, gameDatabaseId, mode],
    );
    return rows[0] === undefined ? null : mapSession(rows[0]);
  }

  public async insertIssuedSession(input: NewGameSession): Promise<number> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO game_sessions
        (public_id, user_id, game_version_id, mode, status, seed_hash, nonce_hash,
         started_at, expires_at)
       VALUES (?, ?, ?, ?, 'issued', ?, ?, ?, ?)`,
      [
        input.publicId,
        input.userDatabaseId,
        input.gameVersionDatabaseId,
        input.mode,
        input.seedHash,
        input.nonceHash,
        input.startedAt,
        input.expiresAt,
      ],
    );
    return result.insertId;
  }

  public async lockOwnedSession(
    userPublicId: string,
    sessionPublicId: string,
  ): Promise<GameSessionRecord | null> {
    const [rows] = await this.connection.execute<SessionRow[]>(
      `${sessionSelect}
       WHERE u.public_id = ? AND s.public_id = ? LIMIT 1 FOR UPDATE`,
      [userPublicId, sessionPublicId],
    );
    return rows[0] === undefined ? null : mapSession(rows[0]);
  }

  public async transitionSession(
    sessionDatabaseId: number,
    from: GameSessionStatus,
    to: GameSessionStatus,
    at: Date,
  ): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `UPDATE game_sessions
       SET status = ?, finished_at = CASE WHEN ? = 'submitted' THEN ? ELSE finished_at END
       WHERE id = ? AND status = ?`,
      [to, to, at, sessionDatabaseId, from],
    );
    if (result.affectedRows !== 1) throw new Error('Game session transition lost its lock');
  }
}

function mapGames(rows: readonly GameRow[]): PublishedGame[] {
  const games = new Map<number, PublishedGame & { characters: PublicGameCharacter[] }>();
  for (const row of rows) {
    let game = games.get(row.databaseId);
    if (game === undefined) {
      game = {
        databaseId: row.databaseId,
        id: row.publicId,
        slug: row.slug,
        name: row.name,
        description: row.description,
        activeVersion: mapVersion(row),
        characters: [],
      };
      games.set(row.databaseId, game);
    }
    if (
      row.characterPublicId !== null &&
      row.characterSlug !== null &&
      row.characterName !== null &&
      row.characterUnlockLevel !== null
    ) {
      game.characters.push({
        id: row.characterPublicId,
        slug: row.characterSlug,
        name: row.characterName,
        unlockLevel: row.characterUnlockLevel,
        cosmeticOnly: true,
      });
    }
  }
  return [...games.values()];
}

function mapVersion(row: {
  readonly versionDatabaseId: number;
  readonly versionPublicId: string;
  readonly versionNumber: string;
  readonly rulesVersion: string;
  readonly scoringRules: unknown;
  readonly maxSessionSeconds: number;
  readonly publishedAt: Date;
}): PublishedGameVersion {
  return {
    databaseId: row.versionDatabaseId,
    id: row.versionPublicId,
    versionNumber: row.versionNumber,
    rulesVersion: row.rulesVersion,
    scoringRules: parseScoringRules(row.scoringRules),
    maxSessionSeconds: row.maxSessionSeconds,
    publishedAt: row.publishedAt,
  };
}

function mapSession(row: SessionRow): GameSessionRecord {
  return {
    databaseId: row.databaseId,
    id: row.publicId,
    userId: row.userPublicId,
    game: { id: row.gamePublicId, slug: row.gameSlug, name: row.gameName },
    version: mapVersion(row),
    mode: row.mode,
    status: row.status,
    seedHash: row.seedHash,
    nonceHash: row.nonceHash,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    finishedAt: row.finishedAt,
  };
}

function parseScoringRules(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Published game scoring rules are invalid');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function isDeadlockError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ER_LOCK_DEADLOCK'
  );
}

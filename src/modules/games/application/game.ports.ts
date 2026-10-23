import type {
  GameSessionMode,
  GameSessionRecord,
  GameSessionStatus,
  PublishedGame,
} from '../domain/game.types.js';

export interface NewGameSession {
  readonly publicId: string;
  readonly userDatabaseId: number;
  readonly gameVersionDatabaseId: number;
  readonly mode: GameSessionMode;
  readonly seedHash: string;
  readonly nonceHash: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
}

export interface GameTransaction {
  findPublishedGameForUpdate(gamePublicId: string): Promise<PublishedGame | null>;
  lockActiveUser(userPublicId: string): Promise<number | null>;
  expireOpenSessions(
    userDatabaseId: number,
    gameDatabaseId: number,
    mode: GameSessionMode,
    at: Date,
  ): Promise<void>;
  findOpenSession(
    userDatabaseId: number,
    gameDatabaseId: number,
    mode: GameSessionMode,
  ): Promise<GameSessionRecord | null>;
  insertIssuedSession(input: NewGameSession): Promise<number>;
  lockOwnedSession(
    userPublicId: string,
    sessionPublicId: string,
  ): Promise<GameSessionRecord | null>;
  transitionSession(
    sessionDatabaseId: number,
    from: GameSessionStatus,
    to: GameSessionStatus,
    at: Date,
  ): Promise<void>;
}

export interface GameRepository {
  listPublishedGames(): Promise<readonly PublishedGame[]>;
  findPublishedGame(gamePublicId: string): Promise<PublishedGame | null>;
  withTransaction<T>(operation: (transaction: GameTransaction) => Promise<T>): Promise<T>;
}

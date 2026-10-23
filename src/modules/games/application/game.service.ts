import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import type { GameRepository } from './game.ports.js';
import type {
  GameSessionMode,
  GameSessionRecord,
  GameSessionStatus,
  GameSessionTransitionTarget,
  IssuedGameSession,
  PublicGame,
  PublicGameSession,
} from '../domain/game.types.js';
import { toPublicGame, toPublicGameSession } from '../domain/game.types.js';

const allowedTransitions: Readonly<Record<GameSessionStatus, readonly GameSessionStatus[]>> = {
  issued: ['active', 'expired', 'abandoned'],
  active: ['submitted', 'expired', 'abandoned'],
  submitted: ['accepted', 'rejected'],
  accepted: [],
  rejected: [],
  expired: [],
  abandoned: [],
};

export class GameService {
  public constructor(
    private readonly repository: GameRepository,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async listGames(): Promise<readonly PublicGame[]> {
    return (await this.repository.listPublishedGames()).map(toPublicGame);
  }

  public async getGame(gameId: string): Promise<PublicGame> {
    const game = await this.repository.findPublishedGame(gameId);
    if (game === null) throw gameNotFound();
    return toPublicGame(game);
  }

  public async createSession(input: {
    readonly userId: string;
    readonly gameId: string;
    readonly mode: GameSessionMode;
  }): Promise<IssuedGameSession> {
    const startedAt = this.now();
    const publicId = randomUUID();
    const seed = createSecret();
    const nonce = createSecret();

    const outcome = await this.repository.withTransaction(async (transaction) => {
      const game = await transaction.findPublishedGameForUpdate(input.gameId);
      if (game === null) return { kind: 'game-not-found' as const };

      const userDatabaseId = await transaction.lockActiveUser(input.userId);
      if (userDatabaseId === null) return { kind: 'account-unavailable' as const };

      await transaction.expireOpenSessions(userDatabaseId, game.databaseId, input.mode, startedAt);
      const duplicate = await transaction.findOpenSession(
        userDatabaseId,
        game.databaseId,
        input.mode,
      );
      if (duplicate !== null) return { kind: 'duplicate' as const };

      const expiresAt = new Date(
        startedAt.getTime() + game.activeVersion.maxSessionSeconds * 1_000,
      );
      const databaseId = await transaction.insertIssuedSession({
        publicId,
        userDatabaseId,
        gameVersionDatabaseId: game.activeVersion.databaseId,
        mode: input.mode,
        seedHash: hashSecret(seed),
        nonceHash: hashSecret(nonce),
        startedAt,
        expiresAt,
      });
      await transaction.transitionSession(databaseId, 'issued', 'active', startedAt);

      const record: GameSessionRecord = {
        databaseId,
        id: publicId,
        userId: input.userId,
        game: { id: game.id, slug: game.slug, name: game.name },
        version: game.activeVersion,
        mode: input.mode,
        status: 'active',
        seedHash: hashSecret(seed),
        nonceHash: hashSecret(nonce),
        startedAt,
        expiresAt,
        finishedAt: null,
      };
      return { kind: 'created' as const, record };
    });

    if (outcome.kind === 'game-not-found') throw gameNotFound();
    if (outcome.kind === 'account-unavailable') {
      throw new ForbiddenError('ACCOUNT_ACCESS_DENIED', 'Account cannot start game sessions');
    }
    if (outcome.kind === 'duplicate') {
      throw new ConflictError(
        'GAME_SESSION_ALREADY_ACTIVE',
        'An open session already exists for this game and mode',
      );
    }

    this.logger.info(
      {
        event: 'game.session.created',
        sessionId: outcome.record.id,
        userId: input.userId,
        gameId: input.gameId,
        mode: input.mode,
      },
      'Game session created',
    );
    return {
      session: toPublicGameSession(outcome.record),
      credentials: { seed, nonce },
    };
  }

  public async getSession(userId: string, sessionId: string): Promise<PublicGameSession> {
    const now = this.now();
    const record = await this.repository.withTransaction(async (transaction) => {
      const session = await transaction.lockOwnedSession(userId, sessionId);
      if (session === null) return null;
      if (isExpirable(session.status) && session.expiresAt.getTime() <= now.getTime()) {
        await transaction.transitionSession(session.databaseId, session.status, 'expired', now);
        return { ...session, status: 'expired' as const };
      }
      return session;
    });
    if (record === null) throw sessionNotFound();
    return toPublicGameSession(record);
  }

  /** Internal-only lifecycle hook for the M06 verifier; there is intentionally no M05 route. */
  public async transitionSession(input: {
    readonly userId: string;
    readonly sessionId: string;
    readonly targetStatus: GameSessionTransitionTarget;
  }): Promise<PublicGameSession> {
    const now = this.now();
    const outcome = await this.repository.withTransaction(async (transaction) => {
      const session = await transaction.lockOwnedSession(input.userId, input.sessionId);
      if (session === null) return { kind: 'not-found' as const };

      if (isExpirable(session.status) && session.expiresAt.getTime() <= now.getTime()) {
        await transaction.transitionSession(session.databaseId, session.status, 'expired', now);
        return { kind: 'expired' as const };
      }
      if (!allowedTransitions[session.status].includes(input.targetStatus)) {
        return { kind: 'invalid-transition' as const };
      }

      await transaction.transitionSession(
        session.databaseId,
        session.status,
        input.targetStatus,
        now,
      );
      return {
        kind: 'transitioned' as const,
        record: {
          ...session,
          status: input.targetStatus,
          finishedAt: input.targetStatus === 'submitted' ? now : session.finishedAt,
        },
      };
    });

    if (outcome.kind === 'not-found') throw sessionNotFound();
    if (outcome.kind === 'expired') {
      throw new ConflictError('GAME_SESSION_EXPIRED', 'Game session has expired');
    }
    if (outcome.kind === 'invalid-transition') {
      throw new ConflictError('GAME_SESSION_STATE_CONFLICT', 'Game session transition is invalid');
    }
    return toPublicGameSession(outcome.record);
  }
}

function createSecret(): string {
  return randomBytes(32).toString('base64url');
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function isExpirable(status: GameSessionStatus): status is 'issued' | 'active' {
  return status === 'issued' || status === 'active';
}

function gameNotFound(): NotFoundError {
  return new NotFoundError('GAME_NOT_FOUND', 'Game was not found');
}

function sessionNotFound(): NotFoundError {
  return new NotFoundError('GAME_SESSION_NOT_FOUND', 'Game session was not found');
}

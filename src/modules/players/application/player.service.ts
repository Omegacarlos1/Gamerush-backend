import {
  ConflictError,
  InvalidRequestError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';
import {
  DuplicateXpIdempotencyError,
  type PlayerRepository,
  type PlayerTransaction,
  type ProfilePatch,
  type XpHistoryCursor,
} from './player.ports.js';
import type { ProgressionPolicyService } from './progression-policy.service.js';
import type {
  PublicPlayerProfile,
  TrustedXpSource,
  XpAwardResult,
  XpHistoryItem,
  XpLedgerRecord,
} from '../domain/player.types.js';
import { toPublicPlayerProfile } from '../domain/player.types.js';

const trustedXpSources = new Set<TrustedXpSource>([
  'gameplay',
  'leaderboard_reward',
  'achievement',
]);
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/;
const cursorTimestampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/;

export interface XpHistoryPage {
  readonly items: readonly XpHistoryItem[];
  readonly nextCursor: string | null;
}

export interface XpAwardInput {
  readonly userId: string;
  readonly amount: number;
  readonly sourceType: string;
  readonly sourceReference: string;
  readonly idempotencyKey: string;
}

export class PlayerService {
  public constructor(
    private readonly repository: PlayerRepository,
    private readonly progressionPolicy: ProgressionPolicyService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async getMyProfile(userId: string): Promise<PublicPlayerProfile> {
    return await this.repository.withTransaction(async (transaction) => {
      const profile = await this.findOrCreateProfile(transaction, userId);
      return toPublicPlayerProfile(profile);
    });
  }

  public async updateMyProfile(userId: string, patch: ProfilePatch): Promise<PublicPlayerProfile> {
    return await this.repository.withTransaction(async (transaction) => {
      const profile = await this.findOrCreateProfile(transaction, userId);
      await transaction.updateProfile(profile.userDatabaseId, patch);
      const updated = await transaction.findProfile(userId);
      if (updated === null) throw new NotFoundError('PLAYER_NOT_FOUND', 'Player was not found');
      return toPublicPlayerProfile(updated);
    });
  }

  public async getMyXpHistory(input: {
    readonly userId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<XpHistoryPage> {
    const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
    const rows = await this.repository.listXpHistory(input.userId, cursor, input.limit + 1);
    const hasMore = rows.length > input.limit;
    const visibleRows = hasMore ? rows.slice(0, input.limit) : rows;
    const last = visibleRows.at(-1);
    return {
      items: visibleRows.map((row) => ({
        amount: row.amount,
        balanceAfter: row.balanceAfter,
        sourceType: row.sourceType,
        sourceReference: row.sourceReference,
        createdAt: row.createdAt,
      })),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ createdAt: last.cursorCreatedAt, id: last.cursorId })
          : null,
    };
  }

  public async awardXp(input: XpAwardInput): Promise<XpAwardResult> {
    const sourceType = validateXpAwardInput(input);

    try {
      return await this.repository.withTransaction(async (transaction) => {
        const earlyReplay = await transaction.findXpLedgerEntry(input.idempotencyKey);
        if (earlyReplay !== null) return replayResult(earlyReplay, input, sourceType);

        const policy = await this.progressionPolicy.loadActive(transaction, this.now());
        let profile = await transaction.lockProfile(input.userId);
        if (profile === null) {
          await transaction.ensureProfile(input.userId, policy.startingLevel);
          profile = await transaction.lockProfile(input.userId);
        }
        if (profile === null) {
          throw new NotFoundError('PLAYER_NOT_FOUND', 'Player was not found');
        }

        const serializedReplay = await transaction.findXpLedgerEntry(input.idempotencyKey);
        if (serializedReplay !== null) return replayResult(serializedReplay, input, sourceType);

        const balanceAfter = profile.totalXp + input.amount;
        if (!Number.isSafeInteger(balanceAfter)) {
          throw new InvalidRequestError('XP award exceeds the supported safe integer range');
        }
        const levelAfter = this.progressionPolicy.levelFromTotalXp(balanceAfter, policy);
        const createdAt = this.now();
        await transaction.insertXpLedgerEntry({
          userDatabaseId: profile.userDatabaseId,
          amount: input.amount,
          balanceAfter,
          sourceType,
          sourceReference: input.sourceReference,
          idempotencyKey: input.idempotencyKey,
          policyVersion: policy.version,
          levelAfter,
          createdAt,
        });
        await transaction.updateProgression(profile.userDatabaseId, balanceAfter, levelAfter);

        return {
          userId: input.userId,
          amount: input.amount,
          balanceAfter,
          levelAfter,
          sourceType,
          sourceReference: input.sourceReference,
          policyVersion: policy.version,
          createdAt,
          replayed: false,
        };
      });
    } catch (error: unknown) {
      if (error instanceof DuplicateXpIdempotencyError) {
        throw new ConflictError('XP_IDEMPOTENCY_CONFLICT', 'XP idempotency key is already in use');
      }
      throw error;
    }
  }

  private async findOrCreateProfile(transaction: PlayerTransaction, userId: string) {
    const existing = await transaction.findProfile(userId);
    if (existing !== null) return existing;
    const policy = await this.progressionPolicy.loadActive(transaction, this.now());
    await transaction.ensureProfile(userId, policy.startingLevel);
    const created = await transaction.lockProfile(userId);
    if (created === null) throw new NotFoundError('PLAYER_NOT_FOUND', 'Player was not found');
    return created;
  }
}

function validateXpAwardInput(input: XpAwardInput): TrustedXpSource {
  if (!trustedXpSources.has(input.sourceType as TrustedXpSource)) {
    throw new InvalidRequestError('XP source is not trusted');
  }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new InvalidRequestError('XP award must be a positive safe integer');
  }
  if (!keyPattern.test(input.idempotencyKey)) {
    throw new InvalidRequestError('XP idempotency key is invalid');
  }
  if (input.sourceReference.length < 1 || input.sourceReference.length > 191) {
    throw new InvalidRequestError('XP source reference is invalid');
  }
  return input.sourceType as TrustedXpSource;
}

function replayResult(
  record: XpLedgerRecord,
  input: XpAwardInput,
  sourceType: TrustedXpSource,
): XpAwardResult {
  if (
    record.userId !== input.userId ||
    record.amount !== input.amount ||
    record.sourceType !== sourceType ||
    record.sourceReference !== input.sourceReference
  ) {
    throw new ConflictError('XP_IDEMPOTENCY_CONFLICT', 'XP idempotency key is already in use');
  }
  return {
    userId: record.userId,
    amount: record.amount,
    balanceAfter: record.balanceAfter,
    levelAfter: record.levelAfter,
    sourceType,
    sourceReference: record.sourceReference,
    policyVersion: record.policyVersion,
    createdAt: record.createdAt,
    replayed: true,
  };
}

function encodeCursor(cursor: XpHistoryCursor): string {
  return Buffer.from(JSON.stringify({ version: 1, ...cursor }), 'utf8').toString('base64url');
}

function decodeCursor(value: string): XpHistoryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('createdAt' in parsed) ||
      typeof parsed.createdAt !== 'string' ||
      !cursorTimestampPattern.test(parsed.createdAt) ||
      !('id' in parsed) ||
      typeof parsed.id !== 'string' ||
      !/^[1-9]\d*$/.test(parsed.id)
    ) {
      throw new Error('Invalid cursor payload');
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new InvalidRequestError('XP history cursor is invalid');
  }
}

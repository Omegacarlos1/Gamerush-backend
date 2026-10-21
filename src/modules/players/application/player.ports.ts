import type {
  PlayerProfileRecord,
  ProgressionPolicyRecord,
  XpHistoryRecord,
  XpLedgerRecord,
} from '../domain/player.types.js';

export interface ProfilePatch {
  readonly displayName?: string | null;
  readonly bio?: string | null;
}

export interface XpHistoryCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface NewXpLedgerEntry {
  readonly userDatabaseId: number;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly sourceType: string;
  readonly sourceReference: string;
  readonly idempotencyKey: string;
  readonly policyVersion: string;
  readonly levelAfter: number;
  readonly createdAt: Date;
}

export interface PlayerTransaction {
  findProfile(userPublicId: string): Promise<PlayerProfileRecord | null>;
  ensureProfile(userPublicId: string, startingLevel: number): Promise<void>;
  lockProfile(userPublicId: string): Promise<PlayerProfileRecord | null>;
  updateProfile(userDatabaseId: number, patch: ProfilePatch): Promise<void>;
  findActiveProgressionPolicy(at: Date): Promise<ProgressionPolicyRecord | null>;
  findXpLedgerEntry(idempotencyKey: string): Promise<XpLedgerRecord | null>;
  insertXpLedgerEntry(input: NewXpLedgerEntry): Promise<void>;
  updateProgression(userDatabaseId: number, totalXp: number, level: number): Promise<void>;
}

export interface PlayerRepository {
  withTransaction<T>(operation: (transaction: PlayerTransaction) => Promise<T>): Promise<T>;
  listXpHistory(
    userPublicId: string,
    cursor: XpHistoryCursor | null,
    limit: number,
  ): Promise<readonly XpHistoryRecord[]>;
}

export class DuplicateXpIdempotencyError extends Error {
  public constructor() {
    super('XP idempotency key is already in use');
    this.name = 'DuplicateXpIdempotencyError';
  }
}

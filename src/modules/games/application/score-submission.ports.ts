import type { ProgressionPolicyRecord } from '../../players/domain/player.types.js';
import type {
  PublicScoreRejectionCode,
  RunnerInputEvent,
  VerifiableGameSession,
  VerifiedScoreResult,
} from './score-verification.ports.js';

export type ScoreSubmissionStatus = 'pending' | 'accepted' | 'rejected';
export type ScorePersistenceStage =
  'submission' | 'events' | 'verified-score' | 'xp-ledger' | 'profile-update';

export interface ScoreSubmissionRecord {
  readonly databaseId: number;
  readonly id: string;
  readonly sessionDatabaseId: number;
  readonly sessionId: string;
  readonly ownerId: string;
  readonly requestDigest: string;
  readonly status: ScoreSubmissionStatus;
  readonly rejectionCode: PublicScoreRejectionCode | null;
  readonly submittedAt: Date;
  readonly processedAt: Date | null;
  readonly result: (VerifiedScoreResult & { readonly xpAwarded: number }) | null;
}

export interface PublicScoreSubmission {
  readonly id: string;
  readonly sessionId: string;
  readonly status: ScoreSubmissionStatus;
  readonly rejectionCode: PublicScoreRejectionCode | null;
  readonly submittedAt: Date;
  readonly processedAt: Date | null;
  readonly result: (VerifiedScoreResult & { readonly xpAwarded: number }) | null;
}

export interface NewScoreSubmission {
  readonly publicId: string;
  readonly sessionDatabaseId: number;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly claimedScore: number;
  readonly claimedMetres: number;
  readonly claimedCoins: number;
  readonly submittedAt: Date;
}

export interface LockedProgressionProfile {
  readonly userDatabaseId: number;
  readonly totalXp: number;
}

export interface ScoreSubmissionTransaction {
  lockOwnedSession(ownerId: string, sessionId: string): Promise<VerifiableGameSession | null>;
  findSubmissionByIdempotency(idempotencyKey: string): Promise<ScoreSubmissionRecord | null>;
  insertSubmission(input: NewScoreSubmission): Promise<number>;
  insertEvents(sessionDatabaseId: number, events: readonly RunnerInputEvent[]): Promise<void>;
  transitionSession(input: {
    readonly sessionDatabaseId: number;
    readonly from: 'active' | 'submitted';
    readonly to: 'submitted' | 'accepted' | 'rejected' | 'expired';
    readonly finishedAt: Date | null;
  }): Promise<void>;
  rejectSubmission(
    submissionDatabaseId: number,
    rejectionCode: PublicScoreRejectionCode,
    processedAt: Date,
  ): Promise<void>;
  insertVerifiedScore(input: {
    readonly publicId: string;
    readonly submissionDatabaseId: number;
    readonly session: VerifiableGameSession;
    readonly result: VerifiedScoreResult;
    readonly verifiedAt: Date;
  }): Promise<void>;
  acceptSubmission(submissionDatabaseId: number, processedAt: Date): Promise<void>;
  findActiveProgressionPolicy(at: Date): Promise<ProgressionPolicyRecord | null>;
  ensureAndLockProfile(
    ownerId: string,
    startingLevel: number,
  ): Promise<LockedProgressionProfile | null>;
  insertGameplayXp(input: {
    readonly profile: LockedProgressionProfile;
    readonly amount: number;
    readonly balanceAfter: number;
    readonly levelAfter: number;
    readonly sourceReference: string;
    readonly idempotencyKey: string;
    readonly policyVersion: string;
    readonly createdAt: Date;
  }): Promise<void>;
  updateProgression(userDatabaseId: number, totalXp: number, level: number): Promise<void>;
}

export interface ScoreSubmissionRepository {
  withTransaction<T>(
    operation: (transaction: ScoreSubmissionTransaction) => Promise<T>,
  ): Promise<T>;
  findOwnedSubmission(ownerId: string, submissionId: string): Promise<ScoreSubmissionRecord | null>;
}

export function toPublicScoreSubmission(record: ScoreSubmissionRecord): PublicScoreSubmission {
  return {
    id: record.id,
    sessionId: record.sessionId,
    status: record.status,
    rejectionCode: record.rejectionCode,
    submittedAt: record.submittedAt,
    processedAt: record.processedAt,
    result: record.result,
  };
}

import type { GameSessionMode, GameSessionStatus } from '../domain/game.types.js';

export const runnerEvidenceContractVersion = 'runner-evidence-v1' as const;
export const runnerRulesVersion = 'runner-score-v1' as const;

export type RunnerInputType = 'jump' | 'moveLeft' | 'moveRight';
export type RunnerTerminalType = 'collision' | 'timeout';
export type PublicScoreRejectionCode =
  'CREDENTIAL_MISMATCH' | 'VERSION_MISMATCH' | 'REPLAY_INVALID' | 'CLAIM_MISMATCH';

/** Server-owned session and immutable rules loaded under a row lock. */
export interface VerifiableGameSession {
  readonly databaseId: number;
  readonly userDatabaseId: number;
  readonly gameDatabaseId: number;
  readonly id: string;
  readonly ownerId: string;
  readonly gameId: string;
  readonly gameVersionId: string;
  readonly rulesVersion: string;
  readonly scoringRules: Readonly<Record<string, unknown>>;
  readonly maxSessionSeconds: number;
  readonly mode: GameSessionMode;
  readonly status: GameSessionStatus;
  readonly seedHash: string;
  readonly nonceHash: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
}

export interface RunnerInputEvent {
  readonly sequence: number;
  readonly tick: number;
  readonly type: RunnerInputType;
  readonly payload: Readonly<Record<string, never>>;
}

export interface ScoreEvidence {
  readonly contractVersion: typeof runnerEvidenceContractVersion;
  readonly gameVersionId: string;
  readonly rulesVersion: string;
  readonly seed: string;
  readonly nonce: string;
  readonly simulationTicks: number;
  readonly terminal: {
    readonly type: RunnerTerminalType;
    readonly tick: number;
  };
  readonly events: readonly RunnerInputEvent[];
  readonly claimed: {
    readonly metres: number;
    readonly coins: number;
    readonly score: number;
  };
}

export interface VerifiedScoreResult {
  readonly metres: number;
  readonly coins: number;
  readonly score: number;
  readonly finishedAt: Date;
}

export type ScoreVerificationResult =
  | { readonly accepted: true; readonly result: VerifiedScoreResult }
  | { readonly accepted: false; readonly category: string };

/** Injected deterministic rules adapter. It never trusts browser result fields. */
export interface ScoreVerificationPort {
  verify(session: VerifiableGameSession, evidence: ScoreEvidence): ScoreVerificationResult;
}

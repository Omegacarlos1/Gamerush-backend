import type { GameSessionMode, GameSessionStatus } from '../domain/game.types.js';

/** M06 boundary: hashes and immutable rules are server data, while raw evidence remains untrusted. */
export interface VerifiableGameSession {
  readonly id: string;
  readonly ownerId: string;
  readonly gameId: string;
  readonly gameVersionId: string;
  readonly rulesVersion: string;
  readonly scoringRules: Readonly<Record<string, unknown>>;
  readonly mode: GameSessionMode;
  readonly status: GameSessionStatus;
  readonly seedHash: string;
  readonly nonceHash: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
}

export interface SessionVerificationPort {
  withLockedOwnedSession<T>(
    ownerId: string,
    sessionId: string,
    operation: (context: {
      readonly session: VerifiableGameSession;
      transition(from: GameSessionStatus, to: GameSessionStatus, at: Date): Promise<void>;
    }) => Promise<T>,
  ): Promise<T | null>;
}

export interface ScoreEvidence {
  readonly seed: string;
  readonly nonce: string;
  readonly events: readonly unknown[];
  readonly simulationTicks: number;
}

export interface VerifiedScoreResult {
  readonly metres: number;
  readonly coins: number;
  readonly score: number;
}

export interface ScoreVerificationPort {
  verify(session: VerifiableGameSession, evidence: ScoreEvidence): Promise<VerifiedScoreResult>;
}

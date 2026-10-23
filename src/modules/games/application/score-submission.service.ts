import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import type { Logger } from 'pino';

import {
  ConflictError,
  InvalidRequestError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../../shared/errors/app-error.js';
import type { ProgressionPolicyService } from '../../players/application/progression-policy.service.js';
import type {
  PublicScoreSubmission,
  ScoreSubmissionRecord,
  ScoreSubmissionRepository,
} from './score-submission.ports.js';
import { toPublicScoreSubmission } from './score-submission.ports.js';
import type {
  PublicScoreRejectionCode,
  ScoreEvidence,
  ScoreVerificationPort,
  VerifiableGameSession,
  VerifiedScoreResult,
} from './score-verification.ports.js';
import { runnerRulesVersion } from './score-verification.ports.js';

const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/;

export interface ScoreSubmissionAttempt {
  readonly submission: PublicScoreSubmission;
  readonly replayed: boolean;
}

export class ScoreSubmissionService {
  public constructor(
    private readonly repository: ScoreSubmissionRepository,
    private readonly verifier: ScoreVerificationPort,
    private readonly progressionPolicy: ProgressionPolicyService,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async submit(input: {
    readonly ownerId: string;
    readonly sessionId: string;
    readonly idempotencyKey: string;
    readonly evidence: ScoreEvidence;
  }): Promise<ScoreSubmissionAttempt> {
    if (!idempotencyKeyPattern.test(input.idempotencyKey)) {
      throw new InvalidRequestError('Idempotency-Key header is invalid');
    }

    const now = this.now();
    const requestDigest = createRequestDigest(input.sessionId, input.evidence);
    const outcome = await this.repository.withTransaction(async (transaction) => {
      const session = await transaction.lockOwnedSession(input.ownerId, input.sessionId);
      if (session === null) return { kind: 'not-found' as const };

      const prior = await transaction.findSubmissionByIdempotency(input.idempotencyKey);
      if (prior !== null) {
        if (
          prior.sessionDatabaseId !== session.databaseId ||
          prior.requestDigest !== requestDigest
        ) {
          return { kind: 'idempotency-conflict' as const };
        }
        return { kind: 'completed' as const, record: prior, replayed: true };
      }

      if (session.mode !== 'ranked') return { kind: 'practice' as const };
      if (session.status !== 'active') return { kind: 'state-conflict' as const };
      if (session.expiresAt.getTime() <= now.getTime()) {
        await transaction.transitionSession({
          sessionDatabaseId: session.databaseId,
          from: 'active',
          to: 'expired',
          finishedAt: null,
        });
        return { kind: 'expired' as const };
      }

      const rejection = determinePreReplayRejection(session, input.evidence);
      const verification =
        rejection === null ? this.verifier.verify(session, input.evidence) : null;
      if (verification?.accepted === false && verification.category === 'unsupported_rules') {
        throw new ServiceUnavailableError();
      }
      const verifiedResult = verification?.accepted === true ? verification.result : null;
      const impossibleTiming =
        verifiedResult !== null &&
        (verifiedResult.finishedAt.getTime() > now.getTime() ||
          verifiedResult.finishedAt.getTime() > session.expiresAt.getTime());
      const finalRejection =
        rejection ??
        (verification?.accepted === false ? 'REPLAY_INVALID' : null) ??
        (impossibleTiming ? 'REPLAY_INVALID' : null) ??
        (verifiedResult !== null && claimsMatch(input.evidence, verifiedResult)
          ? null
          : 'CLAIM_MISMATCH');

      await transaction.transitionSession({
        sessionDatabaseId: session.databaseId,
        from: 'active',
        to: 'submitted',
        finishedAt: null,
      });
      const submissionId = randomUUID();
      const submissionDatabaseId = await transaction.insertSubmission({
        publicId: submissionId,
        sessionDatabaseId: session.databaseId,
        idempotencyKey: input.idempotencyKey,
        requestDigest,
        claimedScore: input.evidence.claimed.score,
        claimedMetres: input.evidence.claimed.metres,
        claimedCoins: input.evidence.claimed.coins,
        submittedAt: now,
      });
      await transaction.insertEvents(session.databaseId, input.evidence.events);

      if (finalRejection !== null || verifiedResult === null) {
        const code = finalRejection ?? 'REPLAY_INVALID';
        await transaction.rejectSubmission(submissionDatabaseId, code, now);
        await transaction.transitionSession({
          sessionDatabaseId: session.databaseId,
          from: 'submitted',
          to: 'rejected',
          finishedAt: now,
        });
        return {
          kind: 'completed' as const,
          replayed: false,
          record: rejectionRecord({
            submissionDatabaseId,
            submissionId,
            session,
            requestDigest,
            code,
            now,
          }),
        };
      }

      const verifiedScoreId = randomUUID();
      await transaction.insertVerifiedScore({
        publicId: verifiedScoreId,
        submissionDatabaseId,
        session,
        result: verifiedResult,
        verifiedAt: now,
      });

      const policy = this.progressionPolicy.validate(
        await transaction.findActiveProgressionPolicy(now),
      );
      const xpAwarded = this.progressionPolicy.xpFromValidatedScore(verifiedResult.score, policy);
      if (xpAwarded > 0) {
        const profile = await transaction.ensureAndLockProfile(
          session.ownerId,
          policy.startingLevel,
        );
        if (profile === null) throw new ServiceUnavailableError();
        const balanceAfter = profile.totalXp + xpAwarded;
        if (!Number.isSafeInteger(balanceAfter)) throw new ServiceUnavailableError();
        const levelAfter = this.progressionPolicy.levelFromTotalXp(balanceAfter, policy);
        await transaction.insertGameplayXp({
          profile,
          amount: xpAwarded,
          balanceAfter,
          levelAfter,
          sourceReference: verifiedScoreId,
          idempotencyKey: gameplayXpKey(session.id),
          policyVersion: policy.version,
          createdAt: now,
        });
        await transaction.updateProgression(profile.userDatabaseId, balanceAfter, levelAfter);
      }

      await transaction.acceptSubmission(submissionDatabaseId, now);
      await transaction.transitionSession({
        sessionDatabaseId: session.databaseId,
        from: 'submitted',
        to: 'accepted',
        finishedAt: verifiedResult.finishedAt,
      });
      return {
        kind: 'completed' as const,
        replayed: false,
        record: acceptedRecord({
          submissionDatabaseId,
          submissionId,
          session,
          requestDigest,
          result: verifiedResult,
          xpAwarded,
          now,
        }),
      };
    });

    if (outcome.kind === 'not-found') throw submissionSessionNotFound();
    if (outcome.kind === 'practice') {
      throw new ConflictError(
        'SCORE_RANKED_SESSION_REQUIRED',
        'Practice sessions cannot create scores or XP',
      );
    }
    if (outcome.kind === 'expired') {
      throw new ConflictError('GAME_SESSION_EXPIRED', 'Game session has expired');
    }
    if (outcome.kind === 'state-conflict') {
      throw new ConflictError(
        'GAME_SESSION_STATE_CONFLICT',
        'Game session cannot accept another submission',
      );
    }
    if (outcome.kind === 'idempotency-conflict') {
      throw new ConflictError('SCORE_IDEMPOTENCY_CONFLICT', 'Idempotency key is already in use');
    }

    this.logger.info(
      {
        event: 'score.submission.processed',
        submissionId: outcome.record.id,
        sessionId: input.sessionId,
        userId: input.ownerId,
        status: outcome.record.status,
        rejectionCode: outcome.record.rejectionCode ?? undefined,
        replayed: outcome.replayed,
      },
      'Score submission processed',
    );
    return {
      submission: toPublicScoreSubmission(outcome.record),
      replayed: outcome.replayed,
    };
  }

  public async getSubmission(
    ownerId: string,
    submissionId: string,
  ): Promise<PublicScoreSubmission> {
    const record = await this.repository.findOwnedSubmission(ownerId, submissionId);
    if (record === null) {
      throw new NotFoundError('SCORE_SUBMISSION_NOT_FOUND', 'Score submission was not found');
    }
    return toPublicScoreSubmission(record);
  }
}

function determinePreReplayRejection(
  session: VerifiableGameSession,
  evidence: ScoreEvidence,
): PublicScoreRejectionCode | null {
  if (
    !constantTimeHashMatch(evidence.seed, session.seedHash) ||
    !constantTimeHashMatch(evidence.nonce, session.nonceHash)
  ) {
    return 'CREDENTIAL_MISMATCH';
  }
  if (
    evidence.gameVersionId !== session.gameVersionId ||
    evidence.rulesVersion !== session.rulesVersion ||
    evidence.rulesVersion !== runnerRulesVersion
  ) {
    return 'VERSION_MISMATCH';
  }
  return null;
}

function constantTimeHashMatch(value: string, expectedHex: string): boolean {
  const actual = Buffer.from(hashSecret(value), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function claimsMatch(evidence: ScoreEvidence, result: VerifiedScoreResult): boolean {
  return (
    evidence.claimed.metres === result.metres &&
    evidence.claimed.coins === result.coins &&
    evidence.claimed.score === result.score
  );
}

function createRequestDigest(sessionId: string, evidence: ScoreEvidence): string {
  const canonical = {
    contractVersion: evidence.contractVersion,
    sessionId,
    gameVersionId: evidence.gameVersionId,
    rulesVersion: evidence.rulesVersion,
    seedHash: hashSecret(evidence.seed),
    nonceHash: hashSecret(evidence.nonce),
    simulationTicks: evidence.simulationTicks,
    terminal: evidence.terminal,
    events: evidence.events.map((event) => ({
      sequence: event.sequence,
      tick: event.tick,
      type: event.type,
      payload: {},
    })),
    claimed: evidence.claimed,
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function gameplayXpKey(sessionId: string): string {
  return `gameplay:${sessionId}`;
}

function rejectionRecord(input: {
  readonly submissionDatabaseId: number;
  readonly submissionId: string;
  readonly session: VerifiableGameSession;
  readonly requestDigest: string;
  readonly code: PublicScoreRejectionCode;
  readonly now: Date;
}): ScoreSubmissionRecord {
  return {
    databaseId: input.submissionDatabaseId,
    id: input.submissionId,
    sessionDatabaseId: input.session.databaseId,
    sessionId: input.session.id,
    ownerId: input.session.ownerId,
    requestDigest: input.requestDigest,
    status: 'rejected',
    rejectionCode: input.code,
    submittedAt: input.now,
    processedAt: input.now,
    result: null,
  };
}

function acceptedRecord(input: {
  readonly submissionDatabaseId: number;
  readonly submissionId: string;
  readonly session: VerifiableGameSession;
  readonly requestDigest: string;
  readonly result: VerifiedScoreResult;
  readonly xpAwarded: number;
  readonly now: Date;
}): ScoreSubmissionRecord {
  return {
    databaseId: input.submissionDatabaseId,
    id: input.submissionId,
    sessionDatabaseId: input.session.databaseId,
    sessionId: input.session.id,
    ownerId: input.session.ownerId,
    requestDigest: input.requestDigest,
    status: 'accepted',
    rejectionCode: null,
    submittedAt: input.now,
    processedAt: input.now,
    result: { ...input.result, xpAwarded: input.xpAwarded },
  };
}

function submissionSessionNotFound(): NotFoundError {
  return new NotFoundError('GAME_SESSION_NOT_FOUND', 'Game session was not found');
}

import type { NextFunction, Request, Response } from 'express';

import type { ScoreSubmissionService } from '../application/score-submission.service.js';
import { authenticatedUser, nextAsync } from '../../auth/presentation/auth.middleware.js';
import {
  idempotencyKeySchema,
  parseScoreInput,
  scoreEvidenceSchema,
  scoreSessionParamsSchema,
  scoreSubmissionParamsSchema,
} from './score-submission.schemas.js';

export class ScoreSubmissionController {
  public constructor(private readonly service: ScoreSubmissionService) {}

  public readonly submit = (request: Request, response: Response, next: NextFunction): void => {
    nextAsync(async () => {
      const { sessionId } = parseScoreInput(scoreSessionParamsSchema, request.params);
      const evidence = parseScoreInput(scoreEvidenceSchema, request.body);
      const idempotencyKey = parseScoreInput(
        idempotencyKeySchema,
        request.header('Idempotency-Key'),
      );
      const attempt = await this.service.submit({
        ownerId: authenticatedUser(response).id,
        sessionId,
        idempotencyKey,
        evidence,
      });
      const status = attempt.replayed ? 200 : attempt.submission.status === 'accepted' ? 201 : 422;
      response.set('Cache-Control', 'no-store').status(status).json({ data: attempt });
    }, next);
  };

  public readonly get = (request: Request, response: Response, next: NextFunction): void => {
    nextAsync(async () => {
      const { submissionId } = parseScoreInput(scoreSubmissionParamsSchema, request.params);
      const submission = await this.service.getSubmission(
        authenticatedUser(response).id,
        submissionId,
      );
      response.set('Cache-Control', 'no-store').status(200).json({ data: { submission } });
    }, next);
  };
}

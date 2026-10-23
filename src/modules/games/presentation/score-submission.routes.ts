import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

import type { AppConfig } from '../../../config/environment.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { responseRequestId } from '../../../shared/http/request-id.js';
import type { AuthService } from '../../auth/application/auth.service.js';
import {
  requireAuthentication,
  requireCsrfProtection,
} from '../../auth/presentation/auth.middleware.js';
import type { ScoreSubmissionService } from '../application/score-submission.service.js';
import { ScoreSubmissionController } from './score-submission.controller.js';

export function createScoreSessionRouter(
  service: ScoreSubmissionService,
  authService: AuthService,
  config: AppConfig,
): Router {
  const router = Router();
  const controller = new ScoreSubmissionController(service);
  const limiter = rateLimit({
    windowMs: config.games.scoreSubmissionRateLimit.windowMs,
    limit: config.games.scoreSubmissionRateLimit.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_request, response) {
      response.status(429).json({
        error: {
          code: 'SCORE_SUBMISSION_RATE_LIMIT_EXCEEDED',
          message: 'Too many score submissions',
          requestId: responseRequestId(response),
        },
      });
    },
  });
  router.post(
    '/:sessionId/scores',
    requireAuthentication(authService, config),
    requireCsrfProtection(authService, config),
    limiter,
    enforceEvidenceSize(config.games.scoreEvidenceMaxBytes),
    controller.submit,
  );
  return router;
}

export function createScoreSubmissionRouter(
  service: ScoreSubmissionService,
  authService: AuthService,
  config: AppConfig,
): Router {
  const router = Router();
  const controller = new ScoreSubmissionController(service);
  router.get('/:submissionId', requireAuthentication(authService, config), controller.get);
  return router;
}

function enforceEvidenceSize(maxBytes: number): RequestHandler {
  return (request, _response, next): void => {
    const contentLength = Number(request.header('content-length'));
    const parsedBytes = Buffer.byteLength(JSON.stringify(request.body), 'utf8');
    if ((Number.isFinite(contentLength) && contentLength > maxBytes) || parsedBytes > maxBytes) {
      next(new AppError(413, 'SCORE_EVIDENCE_TOO_LARGE', 'Score evidence payload is too large'));
      return;
    }
    next();
  };
}

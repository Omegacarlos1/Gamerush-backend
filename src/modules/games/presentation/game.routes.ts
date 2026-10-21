import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import type { AppConfig } from '../../../config/environment.js';
import { responseRequestId } from '../../../shared/http/request-id.js';
import type { AuthService } from '../../auth/application/auth.service.js';
import {
  requireAuthentication,
  requireCsrfProtection,
} from '../../auth/presentation/auth.middleware.js';
import type { GameService } from '../application/game.service.js';
import { GameController } from './game.controller.js';

export function createGameRouter(
  service: GameService,
  authService: AuthService | undefined,
  config: AppConfig,
): Router {
  const router = Router();
  const controller = new GameController(service);

  router.get('/', controller.list);
  router.get('/:gameId', controller.detail);

  if (authService !== undefined) {
    const sessionLimiter = rateLimit({
      windowMs: config.games.sessionRateLimit.windowMs,
      limit: config.games.sessionRateLimit.max,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler(_request, response) {
        response.status(429).json({
          error: {
            code: 'GAME_SESSION_RATE_LIMIT_EXCEEDED',
            message: 'Too many game session requests',
            requestId: responseRequestId(response),
          },
        });
      },
    });
    router.post(
      '/:gameId/sessions',
      requireAuthentication(authService, config),
      requireCsrfProtection(authService, config),
      sessionLimiter,
      controller.createSession,
    );
  }

  return router;
}

export function createGameSessionRouter(
  service: GameService,
  authService: AuthService,
  config: AppConfig,
): Router {
  const router = Router();
  const controller = new GameController(service);
  router.get('/:sessionId', requireAuthentication(authService, config), controller.getSession);
  return router;
}

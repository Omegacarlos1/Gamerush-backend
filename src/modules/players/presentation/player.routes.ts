import { Router } from 'express';

import type { AppConfig } from '../../../config/environment.js';
import type { AuthService } from '../../auth/application/auth.service.js';
import {
  requireAuthentication,
  requireCsrfProtection,
} from '../../auth/presentation/auth.middleware.js';
import type { PlayerService } from '../application/player.service.js';
import { PlayerController } from './player.controller.js';

export function createPlayerRouter(
  playerService: PlayerService,
  authService: AuthService,
  config: AppConfig,
): Router {
  const router = Router();
  const controller = new PlayerController(playerService);
  const authenticate = requireAuthentication(authService, config);

  router.get('/me', authenticate, controller.me);
  router.patch(
    '/me',
    authenticate,
    requireCsrfProtection(authService, config),
    controller.updateMe,
  );
  router.get('/me/xp-history', authenticate, controller.xpHistory);

  return router;
}

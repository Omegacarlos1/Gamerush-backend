import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import type { AppConfig } from '../../../config/environment.js';
import { responseRequestId } from '../../../shared/http/request-id.js';
import type { AuthService } from '../application/auth.service.js';
import { AuthController } from './auth.controller.js';
import { requireAuthentication, requireRole } from './auth.middleware.js';

export function createAuthRouter(service: AuthService, config: AppConfig): Router {
  const router = Router();
  const controller = new AuthController(service, config);
  const sensitiveLimiter = rateLimit({
    windowMs: config.auth.rateLimit.windowMs,
    limit: config.auth.rateLimit.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_request, response) {
      response.status(429).json({
        error: {
          code: 'AUTH_RATE_LIMIT_EXCEEDED',
          message: 'Too many authentication attempts',
          requestId: responseRequestId(response),
        },
      });
    },
  });

  router.post('/register', sensitiveLimiter, controller.register);
  router.post('/verify-email', sensitiveLimiter, controller.verifyEmail);
  router.post('/login', sensitiveLimiter, controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', requireAuthentication(service, config), controller.me);
  router.get(
    '/admin-check',
    requireAuthentication(service, config),
    requireRole('admin'),
    controller.adminCheck,
  );

  return router;
}

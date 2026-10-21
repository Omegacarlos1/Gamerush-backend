import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

import type { AppConfig } from './config/environment.js';
import type { HealthService } from './modules/health/application/health.service.js';
import { createHealthRouter } from './modules/health/presentation/health.routes.js';
import type { AuthService } from './modules/auth/application/auth.service.js';
import { createAuthRouter } from './modules/auth/presentation/auth.routes.js';
import type { PlayerService } from './modules/players/application/player.service.js';
import { createPlayerRouter } from './modules/players/presentation/player.routes.js';
import { CorsOriginError } from './shared/errors/app-error.js';
import { createErrorHandler } from './shared/http/error-handler.js';
import { notFoundHandler } from './shared/http/not-found.js';
import { generateRequestId } from './shared/http/request-id.js';

export interface AppDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly healthService: HealthService;
  readonly authService?: AuthService;
  readonly playerService?: PlayerService;
}

export function createApp({
  config,
  logger,
  healthService,
  authService,
  playerService,
}: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger,
      genReqId: generateRequestId,
      autoLogging: {
        ignore: (request) => request.url === '/api/v1/health',
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (origin === undefined || config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new CorsOriginError());
      },
    }),
  );
  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.max,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler(_request, response) {
        response.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
            requestId: response.getHeader('X-Request-Id'),
          },
        });
      },
    }),
  );
  app.use(express.json({ limit: config.requestBodyLimit, strict: true }));
  app.use(express.urlencoded({ extended: false, limit: config.requestBodyLimit }));

  app.use('/api/v1/health', createHealthRouter(healthService));
  if (authService !== undefined) {
    app.use('/api/v1/auth', createAuthRouter(authService, config));
  }
  if (authService !== undefined && playerService !== undefined) {
    app.use('/api/v1/players', createPlayerRouter(playerService, authService, config));
  }
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}

import pino from 'pino';

import { createApp } from '../../src/app.js';
import { parseEnvironment, type AppConfig } from '../../src/config/environment.js';
import {
  HealthService,
  type DatabaseHealthCheck,
} from '../../src/modules/health/application/health.service.js';

export function createTestConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  return parseEnvironment({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DB_USER: 'playrush_test',
    DB_PASSWORD: 'test-only-password',
    DB_NAME: 'playrush_test',
    CORS_ORIGINS: 'http://localhost:5173',
    AUTH_ACCESS_TOKEN_SECRET: 'test-access-token-secret-at-least-32-characters',
    AUTH_CSRF_SECRET: 'test-csrf-token-secret-at-least-32-characters',
    ...overrides,
  });
}

export function buildTestApp(
  databaseHealthCheck: DatabaseHealthCheck = () => Promise.resolve(),
  config = createTestConfig(),
) {
  const logger = pino({ level: 'silent' });
  const healthService = new HealthService(
    databaseHealthCheck,
    logger,
    () => new Date('2026-10-13T08:00:00.000Z'),
  );

  return createApp({ config, logger, healthService });
}

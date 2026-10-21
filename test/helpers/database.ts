import 'dotenv/config';

import { expect } from 'chai';

import { parseEnvironment, type AppConfig } from '../../src/config/environment.js';

export function createIntegrationDatabaseConfig(): AppConfig {
  const databaseName = process.env.TEST_DB_NAME ?? 'playrush_migrations_test';
  expect(databaseName.toLowerCase()).to.match(/(?:^|_)(?:test)(?:_|$)/);

  return parseEnvironment({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    AUTH_ACCESS_TOKEN_SECRET: 'test-access-token-secret-at-least-32-characters',
    AUTH_CSRF_SECRET: 'test-csrf-token-secret-at-least-32-characters',
    DB_HOST: process.env.TEST_DB_HOST ?? '127.0.0.1',
    DB_PORT: process.env.TEST_DB_PORT ?? '3306',
    DB_USER: process.env.TEST_DB_USER ?? 'root',
    DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? '',
    DB_NAME: databaseName,
  });
}

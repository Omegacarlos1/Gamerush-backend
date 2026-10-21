import 'dotenv/config';

import { createServer } from 'node:http';

import { createApp } from './app.js';
import { EnvironmentValidationError, parseEnvironment } from './config/environment.js';
import { checkMySqlConnection, createMySqlPool } from './infrastructure/database/mysql-pool.js';
import { HealthService } from './modules/health/application/health.service.js';
import { AuthService } from './modules/auth/application/auth.service.js';
import { Argon2PasswordHasher } from './modules/auth/infrastructure/argon2-password-hasher.js';
import { MySqlAuthRepository } from './modules/auth/infrastructure/mysql-auth.repository.js';
import { UnconfiguredVerificationDelivery } from './modules/auth/infrastructure/verification-delivery.js';
import { PlayerService } from './modules/players/application/player.service.js';
import { ProgressionPolicyService } from './modules/players/application/progression-policy.service.js';
import { MySqlPlayerRepository } from './modules/players/infrastructure/mysql-player.repository.js';
import { createLogger } from './shared/logging/logger.js';

async function startServer(): Promise<void> {
  let config;
  try {
    config = parseEnvironment(process.env);
  } catch (error: unknown) {
    const message =
      error instanceof EnvironmentValidationError
        ? error.message
        : 'Unable to validate environment configuration';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger(config);
  const pool = createMySqlPool(config);
  const databaseHealthCheck = (): Promise<void> => checkMySqlConnection(pool);
  const healthService = new HealthService(databaseHealthCheck, logger);
  const authService = new AuthService(
    new MySqlAuthRepository(pool),
    new Argon2PasswordHasher(),
    new UnconfiguredVerificationDelivery(),
    config,
    logger,
  );
  const playerService = new PlayerService(
    new MySqlPlayerRepository(pool),
    new ProgressionPolicyService(),
  );
  const app = createApp({ config, logger, healthService, authService, playerService });
  const server = createServer(app);

  try {
    await databaseHealthCheck();
    logger.info({ event: 'database.connected' }, 'Database connectivity check passed');
  } catch (error: unknown) {
    logger.error(
      {
        event: 'database.connectivity_check.failed',
        errorType: error instanceof Error ? error.name : 'UnknownError',
      },
      'Database connectivity check failed; server will start in degraded state',
    );
  }

  server.listen(config.port, config.host, () => {
    logger.info(
      {
        event: 'server.started',
        host: config.host,
        port: config.port,
      },
      'HTTP server started',
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'server.shutdown.started', signal }, 'Graceful shutdown started');

    server.close(() => {
      void pool
        .end()
        .then(() => {
          logger.info({ event: 'server.shutdown.completed' }, 'Graceful shutdown completed');
        })
        .catch(() => {
          logger.error({ event: 'database.pool.close.failed' }, 'Database pool close failed');
          process.exitCode = 1;
        });
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void startServer();

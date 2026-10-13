export { createApp, type AppDependencies } from './app.js';
export { parseEnvironment, type AppConfig } from './config/environment.js';
export { checkMySqlConnection, createMySqlPool } from './infrastructure/database/mysql-pool.js';
export {
  HealthService,
  type DatabaseHealthCheck,
} from './modules/health/application/health.service.js';
export { createLogger } from './shared/logging/logger.js';

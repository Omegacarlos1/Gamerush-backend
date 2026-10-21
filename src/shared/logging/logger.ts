import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import type { AppConfig } from '../../config/environment.js';

const loggerOptions = (config: AppConfig): LoggerOptions => ({
  level: config.logLevel,
  base: {
    service: 'playrush-backend',
    environment: config.nodeEnv,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'password',
      '*.password',
      'database.password',
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      'token',
      '*.token',
      'accessToken',
      '*.accessToken',
      'refreshToken',
      '*.refreshToken',
      'csrfToken',
      '*.csrfToken',
      'verificationToken',
      '*.verificationToken',
    ],
    censor: '[REDACTED]',
  },
});

export function createLogger(config: AppConfig, destination?: DestinationStream): Logger {
  return destination === undefined
    ? pino(loggerOptions(config))
    : pino(loggerOptions(config), destination);
}

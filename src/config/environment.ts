import { z } from 'zod';

const nodeEnvironments = ['development', 'test', 'production'] as const;
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(nodeEnvironments).default('development'),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(logLevels).default('info'),
    REQUEST_BODY_LIMIT: z
      .string()
      .trim()
      .regex(/^\d+(?:b|kb|mb)$/i, 'must be a size such as 100kb')
      .default('100kb'),
    CORS_ORIGINS: z.string().trim().min(1).default('http://localhost:5173'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    DB_HOST: z.string().trim().min(1).default('127.0.0.1'),
    DB_PORT: z.coerce.number().int().min(1).max(65_535).default(3306),
    DB_USER: z.string().trim().min(1),
    DB_PASSWORD: z.string().default(''),
    DB_NAME: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]+$/, 'must contain only letters, numbers, and underscores'),
    DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
    DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
  })
  .superRefine((environment, context) => {
    const origins = splitOrigins(environment.CORS_ORIGINS);

    if (environment.NODE_ENV === 'production' && origins.includes('*')) {
      context.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'wildcard origins are not allowed in production',
      });
    }

    if (environment.NODE_ENV === 'production' && environment.DB_PASSWORD.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['DB_PASSWORD'],
        message: 'must not be blank in production',
      });
    }

    if (environment.NODE_ENV === 'production' && environment.DB_USER.toLowerCase() === 'root') {
      context.addIssue({
        code: 'custom',
        path: ['DB_USER'],
        message: 'must use a least-privilege account in production',
      });
    }
  });

export interface AppConfig {
  readonly nodeEnv: (typeof nodeEnvironments)[number];
  readonly host: string;
  readonly port: number;
  readonly logLevel: (typeof logLevels)[number];
  readonly requestBodyLimit: string;
  readonly corsOrigins: readonly string[];
  readonly rateLimit: {
    readonly windowMs: number;
    readonly max: number;
  };
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly name: string;
    readonly connectionLimit: number;
    readonly connectTimeoutMs: number;
  };
}

export class EnvironmentValidationError extends Error {
  public constructor(public readonly issues: readonly string[]) {
    super(`Invalid environment configuration: ${issues.join('; ')}`);
    this.name = 'EnvironmentValidationError';
  }
}

function splitOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function parseEnvironment(source: NodeJS.ProcessEnv): AppConfig {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || 'environment';
      return `${path}: ${issue.message}`;
    });
    throw new EnvironmentValidationError(issues);
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    host: result.data.HOST,
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
    requestBodyLimit: result.data.REQUEST_BODY_LIMIT,
    corsOrigins: splitOrigins(result.data.CORS_ORIGINS),
    rateLimit: {
      windowMs: result.data.RATE_LIMIT_WINDOW_MS,
      max: result.data.RATE_LIMIT_MAX,
    },
    database: {
      host: result.data.DB_HOST,
      port: result.data.DB_PORT,
      user: result.data.DB_USER,
      password: result.data.DB_PASSWORD,
      name: result.data.DB_NAME,
      connectionLimit: result.data.DB_CONNECTION_LIMIT,
      connectTimeoutMs: result.data.DB_CONNECT_TIMEOUT_MS,
    },
  };
}

import type { Logger } from 'pino';

import { ServiceUnavailableError } from '../../../shared/errors/app-error.js';

export type DatabaseHealthCheck = () => Promise<void>;

export interface HealthStatus {
  readonly status: 'ok';
  readonly timestamp: string;
  readonly checks: {
    readonly database: 'up';
  };
}

export class HealthService {
  public constructor(
    private readonly databaseHealthCheck: DatabaseHealthCheck,
    private readonly logger: Logger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async getStatus(): Promise<HealthStatus> {
    try {
      await this.databaseHealthCheck();
    } catch (error: unknown) {
      this.logger.error(
        {
          event: 'database.health_check.failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Database health check failed',
      );
      throw new ServiceUnavailableError();
    }

    return {
      status: 'ok',
      timestamp: this.clock().toISOString(),
      checks: {
        database: 'up',
      },
    };
  }
}

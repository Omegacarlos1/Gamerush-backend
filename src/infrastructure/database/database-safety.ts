import type { DatabaseSafetyContext } from './migrations/migration.js';

const safeDatabaseNamePattern = /(?:^|_)(?:dev|development|test)(?:_|$)/i;

export class UnsafeDatabaseOperationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UnsafeDatabaseOperationError';
  }
}

export function assertSafeDatabaseOperation(
  operation: 'rollback' | 'seed',
  context: DatabaseSafetyContext,
): void {
  if (context.nodeEnv === 'production') {
    throw new UnsafeDatabaseOperationError(`${operation} is disabled in production`);
  }
  if (!safeDatabaseNamePattern.test(context.databaseName)) {
    throw new UnsafeDatabaseOperationError(
      `${operation} requires a database name explicitly scoped to development or test`,
    );
  }
}

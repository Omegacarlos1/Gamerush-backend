import { expect } from 'chai';

import {
  assertSafeDatabaseOperation,
  UnsafeDatabaseOperationError,
} from '../../src/infrastructure/database/database-safety.js';

describe('database safety guard', () => {
  it('allows destructive operations only on explicit development/test databases', () => {
    expect(() =>
      assertSafeDatabaseOperation('rollback', {
        nodeEnv: 'test',
        databaseName: 'playrush_migrations_test',
      }),
    ).not.to.throw();
    expect(() =>
      assertSafeDatabaseOperation('seed', {
        nodeEnv: 'development',
        databaseName: 'playrush_dev',
      }),
    ).not.to.throw();
  });

  it('refuses production even when the database name contains development', () => {
    expect(() =>
      assertSafeDatabaseOperation('seed', {
        nodeEnv: 'production',
        databaseName: 'playrush_dev',
      }),
    ).to.throw(UnsafeDatabaseOperationError, 'disabled in production');
  });

  it('refuses an ambiguous database name', () => {
    expect(() =>
      assertSafeDatabaseOperation('rollback', {
        nodeEnv: 'development',
        databaseName: 'playrush',
      }),
    ).to.throw(UnsafeDatabaseOperationError, 'explicitly scoped');
  });
});

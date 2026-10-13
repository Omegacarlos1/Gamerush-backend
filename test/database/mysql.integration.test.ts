import { expect } from 'chai';

import { parseEnvironment } from '../../src/config/environment.js';
import {
  checkMySqlConnection,
  createMySqlPool,
} from '../../src/infrastructure/database/mysql-pool.js';

describe('XAMPP MariaDB connectivity', () => {
  it('connects to the isolated test database using a read-only probe', async () => {
    const databaseName = process.env.TEST_DB_NAME ?? 'playrush_test';
    expect(databaseName.toLowerCase()).to.match(/(?:^|_)test(?:$|_)/);

    const config = parseEnvironment({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DB_HOST: process.env.TEST_DB_HOST ?? '127.0.0.1',
      DB_PORT: process.env.TEST_DB_PORT ?? '3306',
      DB_USER: process.env.TEST_DB_USER ?? 'root',
      DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? '',
      DB_NAME: databaseName,
    });
    const pool = createMySqlPool(config);

    try {
      await checkMySqlConnection(pool);
    } finally {
      await pool.end();
    }
  });
});

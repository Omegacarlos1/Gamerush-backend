import {
  checkMySqlConnection,
  createMySqlPool,
} from '../../src/infrastructure/database/mysql-pool.js';
import { createIntegrationDatabaseConfig } from '../helpers/database.js';

describe('XAMPP MariaDB connectivity', () => {
  it('connects to the isolated test database using a read-only probe', async () => {
    const config = createIntegrationDatabaseConfig();
    const pool = createMySqlPool(config);

    try {
      await checkMySqlConnection(pool);
    } finally {
      await pool.end();
    }
  });
});

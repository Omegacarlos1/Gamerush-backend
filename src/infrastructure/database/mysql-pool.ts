import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';

import type { AppConfig } from '../../config/environment.js';

export function createMySqlPool(config: AppConfig): Pool {
  return mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
    connectionLimit: config.database.connectionLimit,
    connectTimeout: config.database.connectTimeoutMs,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
    decimalNumbers: false,
    namedPlaceholders: false,
  });
}

export async function checkMySqlConnection(pool: Pool): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT 1 AS health_check');
  if (rows[0]?.health_check !== 1) {
    throw new Error('Database health check returned an unexpected result');
  }
}

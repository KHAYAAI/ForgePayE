import { Pool } from 'pg';
import { config } from '../config.js';
import { createDbPool } from '../../../lib/db.js';

let _pool: Pool | null = null;

export function getDb(): Pool {
  if (!_pool) {
    _pool = createDbPool({
      host: config.postgres.host,
      port: config.postgres.port,
      user: config.postgres.user,
      password: config.postgres.password,
      database: config.postgres.database,
      poolMax: parseInt(process.env['DB_POOL_MAX'] ?? '20', 10),
      poolMin: parseInt(process.env['DB_POOL_MIN'] ?? '2', 10),
      idleTimeoutMs: parseInt(process.env['DB_IDLE_TIMEOUT_MS'] ?? '30000', 10),
      statementTimeoutMs: parseInt(process.env['DB_STATEMENT_TIMEOUT_MS'] ?? '5000', 10),
      logSlowQueryMs: parseInt(process.env['POSTGRES_LOG_SLOW_MS'] ?? '500', 10),
    });
  }
  return _pool;
}

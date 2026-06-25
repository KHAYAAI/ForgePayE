import { Pool } from 'pg';
import { logger } from './logger.js';
import { createDbPool as createStandardDbPool, DbPoolConfig } from '../../../lib/db.js';

interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
}

export function createDbPool(cfg: DbConfig): Pool {
  const standardConfig: DbPoolConfig = {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    poolMax: cfg.max ?? parseInt(process.env['DB_POOL_MAX'] ?? '20', 10),
    poolMin: parseInt(process.env['DB_POOL_MIN'] ?? '2', 10),
    idleTimeoutMs: parseInt(process.env['DB_IDLE_TIMEOUT_MS'] ?? '30000', 10),
    statementTimeoutMs: parseInt(process.env['DB_STATEMENT_TIMEOUT_MS'] ?? '5000', 10),
    logSlowQueryMs: parseInt(process.env['POSTGRES_LOG_SLOW_MS'] ?? '500', 10),
  };

  return createStandardDbPool(standardConfig);
}

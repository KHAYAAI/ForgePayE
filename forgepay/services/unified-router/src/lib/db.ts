import { Pool } from 'pg';
import { logger } from './logger.js';

interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max: number;
}

export function createDbPool(cfg: DbConfig): Pool {
  const pool = new Pool({
    host:     cfg.host,
    port:     cfg.port,
    database: cfg.database,
    user:     cfg.user,
    password: cfg.password,
    max:      cfg.max,
    idleTimeoutMillis:    30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => logger.error({ err }, 'Postgres pool error'));

  return pool;
}

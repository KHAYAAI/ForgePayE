/**
 * PostgreSQL connection pool for stablecoin-gateway.
 *
 * Self-contained by necessity: this used to delegate to the shared
 * ../../../lib/db.ts at the monorepo root, but this service's Dockerfile
 * only `COPY src/ ./src/` — that root lib is unreachable at build time (the
 * import resolved to nothing and `tsc` failed with TS2307). Inlined here
 * instead of fixing the Docker build context, matching the fix already
 * applied in unified-router's src/lib/db.ts for the same broken
 * cross-directory import pattern.
 */

import { Pool, PoolClient } from 'pg';
import { config } from '../config.js';
import { logger } from './logger.js';

interface DbPoolConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  poolMax: number;
  poolMin: number;
  idleTimeoutMs: number;
  statementTimeoutMs: number;
  logSlowQueryMs: number;
}

function createDbPool(cfg: DbPoolConfig): Pool {
  logger.info(
    { host: cfg.host, port: cfg.port, database: cfg.database, poolMax: cfg.poolMax, poolMin: cfg.poolMin },
    '[db] creating database pool',
  );

  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    max: cfg.poolMax,
    min: Math.min(cfg.poolMin, cfg.poolMax),
    idleTimeoutMillis: cfg.idleTimeoutMs,
    connectionTimeoutMillis: cfg.statementTimeoutMs,
  });

  pool.on('error', (err: Error, _client: PoolClient) => {
    logger.error({ err }, '[db] unhandled error in PostgreSQL pool');
  });

  return pool;
}

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

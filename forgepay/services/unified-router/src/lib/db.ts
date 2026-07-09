/**
 * PostgreSQL connection pool for unified-router.
 *
 * Self-contained by necessity: this used to delegate to the shared
 * ../../../lib/db.ts at the monorepo root, but this service's Dockerfile
 * only `COPY src/ ./src/` — that root lib is unreachable at build time (the
 * import resolved to nothing and `tsc` failed with TS2307). Inlined here
 * instead of fixing the Docker build context, since the same broken
 * cross-directory import pattern exists in accounts-service, crypto-gateway,
 * and stablecoin-gateway and a build-context change is a bigger, riskier
 * change to make blind across four services' Dockerfiles/CI/Helm at once.
 */

import { Pool, PoolClient } from 'pg';
import { logger } from './logger.js';

interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
}

export function createDbPool(cfg: DbConfig): Pool {
  const poolMax = cfg.max ?? parseInt(process.env['DB_POOL_MAX'] ?? '20', 10);
  const poolMin = parseInt(process.env['DB_POOL_MIN'] ?? '2', 10);
  const idleTimeoutMs = parseInt(process.env['DB_IDLE_TIMEOUT_MS'] ?? '30000', 10);
  const connectionTimeoutMs = parseInt(process.env['DB_STATEMENT_TIMEOUT_MS'] ?? '5000', 10);

  logger.info(
    { host: cfg.host, port: cfg.port, database: cfg.database, poolMax, poolMin },
    '[db] creating database pool',
  );

  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    max: poolMax,
    min: Math.min(poolMin, poolMax),
    idleTimeoutMillis: idleTimeoutMs,
    connectionTimeoutMillis: connectionTimeoutMs,
  });

  pool.on('error', (err: Error, _client: PoolClient) => {
    logger.error({ err }, '[db] unhandled error in PostgreSQL pool');
  });

  return pool;
}

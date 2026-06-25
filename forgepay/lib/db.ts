/**
 * Standardized PostgreSQL Connection Pool Configuration
 * ──────────────────────────────────────────────────────────────────────────
 * Universal database pool template for all ForgePay services.
 * Parses environment variables with validation and sensible defaults.
 *
 * Environment Variables:
 *   DB_HOST                 - PostgreSQL hostname (default: localhost)
 *   DB_PORT                 - PostgreSQL port (default: 5432)
 *   DB_USER                 - Database user (default: postgres)
 *   DB_PASSWORD             - Database password (default: postgres)
 *   DB_NAME                 - Database name (default: forgepay)
 *   DB_POOL_MAX             - Maximum pool connections (default: 20)
 *   DB_POOL_MIN             - Minimum pool connections (default: 2)
 *   DB_IDLE_TIMEOUT_MS      - Idle connection timeout (default: 30000)
 *   DB_STATEMENT_TIMEOUT_MS - Query statement timeout (default: 5000)
 *   POSTGRES_LOG_SLOW_MS    - Log slow query threshold (default: 500)
 */

import { Pool, PoolClient, PoolErrorCallback } from 'pg';
import pino from 'pino';

export interface DbPoolConfig {
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

/**
 * Parse and validate database pool configuration from environment variables.
 * Includes validation to ensure pool settings are sane.
 */
export function parseDbPoolConfig(): DbPoolConfig {
  const logger = pino({ name: 'db:config' });

  // Connection settings
  const host = process.env['DB_HOST'] ?? 'localhost';
  const port = parseInt(process.env['DB_PORT'] ?? '5432', 10);
  const user = process.env['DB_USER'] ?? 'postgres';
  const password = process.env['DB_PASSWORD'] ?? 'postgres';
  const database = process.env['DB_NAME'] ?? 'forgepay';

  // Pool settings with validation
  const poolMax = Math.max(1, parseInt(process.env['DB_POOL_MAX'] ?? '20', 10));
  const poolMin = Math.max(0, parseInt(process.env['DB_POOL_MIN'] ?? '2', 10));

  if (poolMin > poolMax) {
    logger.warn(
      { poolMin, poolMax },
      'Pool min > max; adjusting min to match max',
    );
  }

  const idleTimeoutMs = Math.max(0, parseInt(process.env['DB_IDLE_TIMEOUT_MS'] ?? '30000', 10));
  const statementTimeoutMs = Math.max(0, parseInt(process.env['DB_STATEMENT_TIMEOUT_MS'] ?? '5000', 10));
  const logSlowQueryMs = Math.max(0, parseInt(process.env['POSTGRES_LOG_SLOW_MS'] ?? '500', 10));

  return {
    host,
    port,
    user,
    password,
    database,
    poolMax,
    poolMin: Math.min(poolMin, poolMax),
    idleTimeoutMs,
    statementTimeoutMs,
    logSlowQueryMs,
  };
}

/**
 * Create a standardized PostgreSQL connection pool.
 * Includes error handlers and logging for pool diagnostics.
 */
export function createDbPool(config?: DbPoolConfig): Pool {
  const logger = pino({ name: 'db' });
  const cfg = config ?? parseDbPoolConfig();

  logger.info(
    {
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      poolMax: cfg.poolMax,
      poolMin: cfg.poolMin,
      idleTimeoutMs: cfg.idleTimeoutMs,
      statementTimeoutMs: cfg.statementTimeoutMs,
    },
    'Creating database pool',
  );

  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    max: cfg.poolMax,
    min: cfg.poolMin,
    idleTimeoutMillis: cfg.idleTimeoutMs,
    connectionTimeoutMillis: cfg.statementTimeoutMs,
  });

  // Error handler for pool-level errors
  const errorHandler: PoolErrorCallback = (err: Error, client: PoolClient) => {
    logger.error(
      {
        err,
        clientId: (client as any)?.id,
      },
      'Unhandled error in PostgreSQL pool',
    );
  };

  pool.on('error', errorHandler);

  // Log pool connection events in debug mode
  pool.on('connect', () => {
    logger.debug('Pool connection established');
  });

  pool.on('remove', () => {
    logger.debug('Pool connection removed');
  });

  return pool;
}

/**
 * Initialize database and verify connectivity.
 * Call this during application startup.
 */
export async function initDb(pool: Pool): Promise<void> {
  const logger = pino({ name: 'db' });

  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT NOW()');
      logger.info(
        { timestamp: result.rows[0]?.now },
        'Database connection verified',
      );
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'Failed to verify database connection');
    throw err;
  }
}

/**
 * Gracefully close the database pool.
 * Call this during application shutdown.
 */
export async function closeDb(pool: Pool): Promise<void> {
  const logger = pino({ name: 'db' });

  try {
    await pool.end();
    logger.info('Database pool closed');
  } catch (err) {
    logger.error({ err }, 'Error closing database pool');
  }
}

export type { PoolClient } from 'pg';

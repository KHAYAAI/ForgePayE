import { Pool } from 'pg';
import { config } from '../config.js';
import { logger } from './logger.js';
function createDbPool(cfg) {
    logger.info({
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        poolMax: cfg.poolMax,
        poolMin: cfg.poolMin,
    }, '[db] creating database pool');
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
    pool.on('error', (err, _client) => {
        logger.error({ err }, '[db] unhandled error in PostgreSQL pool');
    });
    return pool;
}
let _pool = null;
export function getDb() {
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
//# sourceMappingURL=db.js.map
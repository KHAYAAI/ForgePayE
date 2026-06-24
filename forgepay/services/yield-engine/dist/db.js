"use strict";
/**
 * PostgreSQL Database Layer for yield-engine.
 *
 * Provides connection pooling and basic CRUD operations for persistent storage
 * of DeFi positions, sweep configs, and transactions.
 *
 * Uses the `pg` library (already available from Hyperswitch / ForgePay base).
 * Migrations run automatically on startup.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
exports.closeDb = closeDb;
exports.getPool = getPool;
exports.upsertPosition = upsertPosition;
exports.loadAllPositions = loadAllPositions;
exports.loadPositionById = loadPositionById;
exports.upsertTransaction = upsertTransaction;
exports.loadTransactionsByMerchant = loadTransactionsByMerchant;
exports.upsertSweepConfig = upsertSweepConfig;
exports.loadAllSweepConfigs = loadAllSweepConfigs;
const pino_1 = __importDefault(require("pino"));
const pg_1 = require("pg");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const logger = (0, pino_1.default)({ name: 'db' });
// ── Configuration ─────────────────────────────────────────────────────────────
const dbConfig = {
    host: process.env['DB_HOST'] ?? 'localhost',
    port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
    user: process.env['DB_USER'] ?? 'postgres',
    password: process.env['DB_PASSWORD'] ?? 'postgres',
    database: process.env['DB_NAME'] ?? 'forgepay',
};
let pool = null;
// ── Initialization ────────────────────────────────────────────────────────────
/**
 * Initialize the database connection pool.
 * Call this once during app startup.
 */
async function initDb() {
    try {
        pool = new pg_1.Pool(dbConfig);
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        logger.info({ timestamp: result.rows[0].now }, 'Database connected');
        client.release();
        // Run migrations
        await runMigrations();
    }
    catch (err) {
        logger.error({ err }, 'Failed to connect to database');
        throw err;
    }
}
/**
 * Close the database connection pool.
 * Call this during graceful shutdown.
 */
async function closeDb() {
    if (pool) {
        await pool.end();
        logger.info('Database connection pool closed');
    }
}
/**
 * Get a client from the pool for manual queries.
 * Remember to release it when done.
 */
function getPool() {
    if (!pool)
        throw new Error('Database not initialized');
    return pool;
}
// ── Migrations ────────────────────────────────────────────────────────────────
/**
 * Read and execute migration files in order.
 * Migrations are stored in src/db/migrations/ as .sql files.
 */
async function runMigrations() {
    const client = await getPool().connect();
    try {
        // Create migrations table if it doesn't exist
        await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
        // Find all migration files
        const migrationsDir = path_1.default.join(__dirname, 'db', 'migrations');
        if (!fs_1.default.existsSync(migrationsDir)) {
            logger.info('No migrations directory found; skipping migrations');
            return;
        }
        const files = fs_1.default
            .readdirSync(migrationsDir)
            .filter((f) => f.endsWith('.sql'))
            .sort();
        for (const file of files) {
            const result = await client.query('SELECT id FROM _migrations WHERE name = $1', [file]);
            if (result.rows.length > 0) {
                logger.debug({ file }, 'Migration already applied');
                continue;
            }
            logger.info({ file }, 'Applying migration');
            const filePath = path_1.default.join(migrationsDir, file);
            const sql = fs_1.default.readFileSync(filePath, 'utf-8');
            // Execute migration (use transaction)
            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
                logger.info({ file }, 'Migration applied successfully');
            }
            catch (err) {
                await client.query('ROLLBACK');
                logger.error({ file, err }, 'Migration failed');
                throw err;
            }
        }
    }
    finally {
        client.release();
    }
}
// ── Position operations ───────────────────────────────────────────────────────
/**
 * Persist a position to the database.
 * Uses UPSERT (ON CONFLICT DO UPDATE) for idempotency.
 */
async function upsertPosition(position) {
    if (!pool)
        return; // Gracefully skip if DB not initialized
    try {
        await pool.query(`
      INSERT INTO yield_positions (
        id,
        merchant_id,
        vault_id,
        principal,
        shares,
        current_value,
        unrealized_yield,
        realized_yield,
        deposited_at,
        last_updated_at,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        principal = EXCLUDED.principal,
        shares = EXCLUDED.shares,
        current_value = EXCLUDED.current_value,
        unrealized_yield = EXCLUDED.unrealized_yield,
        realized_yield = EXCLUDED.realized_yield,
        last_updated_at = EXCLUDED.last_updated_at,
        status = EXCLUDED.status
      `, [
            position.id,
            position.merchantId,
            position.vaultId,
            position.principal,
            position.shares,
            position.currentValue,
            position.unrealizedYield,
            position.realizedYield,
            position.depositedAt,
            position.lastUpdatedAt,
            position.status,
        ]);
    }
    catch (err) {
        // Log but don't throw — allow in-memory cache to continue
        logger.warn({ positionId: position.id, err }, 'Failed to upsert position to DB');
    }
}
/**
 * Load all positions from the database.
 * Called during startup to restore state from persistent storage.
 */
async function loadAllPositions() {
    if (!pool)
        return [];
    try {
        const result = await pool.query(`
      SELECT
        id,
        merchant_id,
        vault_id,
        principal,
        shares,
        current_value,
        unrealized_yield,
        realized_yield,
        deposited_at,
        last_updated_at,
        status
      FROM yield_positions
      ORDER BY last_updated_at DESC
      `);
        return result.rows.map((row) => ({
            id: row.id,
            merchantId: row.merchant_id,
            vaultId: row.vault_id,
            principal: row.principal,
            shares: row.shares,
            currentValue: row.current_value,
            unrealizedYield: row.unrealized_yield,
            realizedYield: row.realized_yield,
            depositedAt: row.deposited_at,
            lastUpdatedAt: row.last_updated_at,
            status: row.status,
        }));
    }
    catch (err) {
        logger.warn({ err }, 'Failed to load positions from DB');
        return [];
    }
}
/**
 * Load a single position by ID.
 */
async function loadPositionById(id) {
    if (!pool)
        return null;
    try {
        const result = await pool.query(`
      SELECT
        id,
        merchant_id,
        vault_id,
        principal,
        shares,
        current_value,
        unrealized_yield,
        realized_yield,
        deposited_at,
        last_updated_at,
        status
      FROM yield_positions
      WHERE id = $1
      `, [id]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        return {
            id: row.id,
            merchantId: row.merchant_id,
            vaultId: row.vault_id,
            principal: row.principal,
            shares: row.shares,
            currentValue: row.current_value,
            unrealizedYield: row.unrealized_yield,
            realizedYield: row.realized_yield,
            depositedAt: row.deposited_at,
            lastUpdatedAt: row.last_updated_at,
            status: row.status,
        };
    }
    catch (err) {
        logger.warn({ positionId: id, err }, 'Failed to load position from DB');
        return null;
    }
}
// ── Transaction operations ────────────────────────────────────────────────────
/**
 * Persist a transaction to the database.
 * Uses UPSERT for idempotency.
 */
async function upsertTransaction(tx) {
    if (!pool)
        return;
    try {
        await pool.query(`
      INSERT INTO yield_transactions (
        id,
        merchant_id,
        position_id,
        type,
        amount,
        asset,
        tx_hash,
        chain,
        status,
        created_at,
        confirmed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        tx_hash = EXCLUDED.tx_hash,
        confirmed_at = EXCLUDED.confirmed_at
      `, [
            tx.id,
            tx.merchantId,
            tx.positionId,
            tx.type,
            tx.amount,
            tx.asset,
            tx.txHash ?? null,
            tx.chain,
            tx.status,
            tx.createdAt,
            tx.confirmedAt ?? null,
        ]);
    }
    catch (err) {
        logger.warn({ txId: tx.id, err }, 'Failed to upsert transaction to DB');
    }
}
/**
 * Load all transactions for a merchant.
 */
async function loadTransactionsByMerchant(merchantId) {
    if (!pool)
        return [];
    try {
        const result = await pool.query(`
      SELECT
        id,
        merchant_id,
        position_id,
        type,
        amount,
        asset,
        tx_hash,
        chain,
        status,
        created_at,
        confirmed_at
      FROM yield_transactions
      WHERE merchant_id = $1
      ORDER BY created_at DESC
      `, [merchantId]);
        return result.rows.map((row) => ({
            id: row.id,
            merchantId: row.merchant_id,
            positionId: row.position_id,
            type: row.type,
            amount: row.amount,
            asset: row.asset,
            txHash: row.tx_hash,
            chain: row.chain,
            status: row.status,
            createdAt: row.created_at,
            confirmedAt: row.confirmed_at,
        }));
    }
    catch (err) {
        logger.warn({ merchantId, err }, 'Failed to load transactions from DB');
        return [];
    }
}
// ── Sweep config operations ───────────────────────────────────────────────────
/**
 * Persist a sweep config to the database.
 * Uses UPSERT for idempotency.
 */
async function upsertSweepConfig(config) {
    if (!pool)
        return;
    try {
        await pool.query(`
      INSERT INTO sweep_configs (
        merchant_id,
        enabled,
        idle_threshold_usd,
        target_vault_id,
        keep_reserve_usd,
        auto_compound
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (merchant_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        idle_threshold_usd = EXCLUDED.idle_threshold_usd,
        target_vault_id = EXCLUDED.target_vault_id,
        keep_reserve_usd = EXCLUDED.keep_reserve_usd,
        auto_compound = EXCLUDED.auto_compound
      `, [
            config.merchantId,
            config.enabled,
            config.idleThresholdUsd,
            config.targetVaultId,
            config.keepReserveUsd,
            config.autoCompound,
        ]);
    }
    catch (err) {
        logger.warn({ merchantId: config.merchantId, err }, 'Failed to upsert sweep config to DB');
    }
}
/**
 * Load all sweep configs from the database.
 */
async function loadAllSweepConfigs() {
    if (!pool)
        return [];
    try {
        const result = await pool.query(`
      SELECT
        merchant_id,
        enabled,
        idle_threshold_usd,
        target_vault_id,
        keep_reserve_usd,
        auto_compound
      FROM sweep_configs
      `);
        return result.rows.map((row) => ({
            merchantId: row.merchant_id,
            enabled: row.enabled,
            idleThresholdUsd: row.idle_threshold_usd,
            targetVaultId: row.target_vault_id,
            keepReserveUsd: row.keep_reserve_usd,
            autoCompound: row.auto_compound,
        }));
    }
    catch (err) {
        logger.warn({ err }, 'Failed to load sweep configs from DB');
        return [];
    }
}
//# sourceMappingURL=db.js.map
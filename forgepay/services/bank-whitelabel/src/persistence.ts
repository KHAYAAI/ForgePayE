/**
 * Durable state for the Bank White-Label Module.
 *
 * Banks, their admins, customers, transactions and the audit log lived only in memory, so a restart lost all of it, including
 * the day's transactions that the daily-limit check reads (limits reset on every deploy) and the record of what admins did.
 * Now each change is written through to Postgres and everything is loaded back at start.
 *
 * Configure with DATABASE_URL or DB_HOST. With neither it runs in memory (development); in production it refuses to start
 * without one. A write that fails after its retries is counted (persistenceFailures, on /health), never silent. A crash in the
 * milliseconds before a write lands can still drop that one record.
 *
 * Known limits: all rows are loaded into memory at start (fine at pilot scale; transactions will need paging later), and a
 * bank's webhook signing key is stored as the bank holds it (it must be recoverable to sign), so encrypt the database volume.
 */

import { Pool } from 'pg';
import type { Bank, BankAdmin, BankCustomer, BankTransaction } from './types.js';
import { hydrateStore, setStoreSink, type AuditEntry } from './store.js';

const MAX_ATTEMPTS = 3;

export function isDbEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env['DATABASE_URL'] || env['DB_HOST']);
}

export function assertPersistenceConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env['NODE_ENV'] === 'production' && !isDbEnabled(env)) {
    throw new Error(
      'bank-whitelabel refuses to start in production without a database (set DATABASE_URL or DB_HOST): ' +
      'without one every bank, admin, customer, transaction and audit entry is lost on restart.',
    );
  }
}

let pool: Pool | null = null;
let failures = 0;
export const persistenceFailures = (): number => failures;

function getPool(): Pool {
  if (!pool) {
    pool = process.env['DATABASE_URL']
      ? new Pool({ connectionString: process.env['DATABASE_URL'], max: 10 })
      : new Pool({
          host: process.env['DB_HOST'] ?? 'localhost',
          port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
          user: process.env['DB_USER'] ?? 'postgres',
          password: process.env['DB_PASSWORD'] ?? 'postgres',
          database: process.env['DB_NAME'] ?? 'forgepay',
          max: parseInt(process.env['DB_POOL_MAX'] ?? '10', 10),
        });
    pool.on('error', (err) => console.error('[bank-whitelabel] postgres pool error', err));
  }
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}

async function persist(what: string, write: () => Promise<unknown>): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await write();
      return;
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) {
        failures += 1;
        console.error(`[bank-whitelabel] failed to persist ${what}:`, e);
        return;
      }
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
}

export async function runMigrations(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS bwl_banks (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS bwl_admins (
      id TEXT PRIMARY KEY, bank_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE, data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bwl_customers (
      id TEXT PRIMARY KEY, bank_id TEXT NOT NULL, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bwl_customers_bank ON bwl_customers(bank_id);
    CREATE TABLE IF NOT EXISTS bwl_transactions (
      id TEXT PRIMARY KEY, bank_id TEXT NOT NULL, customer_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
      data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bwl_transactions_bank ON bwl_transactions(bank_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS bwl_audit (
      id TEXT PRIMARY KEY, bank_id TEXT NOT NULL, at TIMESTAMPTZ NOT NULL, data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bwl_audit_bank ON bwl_audit(bank_id, at DESC);
  `);
}

/** Migrate, load everything back into memory, and start writing changes through. Call before listening. */
export async function initPersistence(): Promise<void> {
  assertPersistenceConfigured();
  if (!isDbEnabled()) return;
  const db = getPool();
  await runMigrations();

  const [b, a, c, t, au] = await Promise.all([
    db.query<{ data: Bank }>(`SELECT data FROM bwl_banks`),
    db.query<{ data: BankAdmin }>(`SELECT data FROM bwl_admins`),
    db.query<{ data: BankCustomer }>(`SELECT data FROM bwl_customers`),
    db.query<{ data: BankTransaction }>(`SELECT data FROM bwl_transactions ORDER BY created_at`),
    db.query<{ data: AuditEntry }>(`SELECT data FROM (SELECT data, at FROM bwl_audit ORDER BY at DESC LIMIT 2000) x ORDER BY at`),
  ]);
  // A database that already holds banks is authoritative: the development demo bank must not return alongside real ones.
  const anyStored = b.rowCount! + a.rowCount! + c.rowCount! + t.rowCount! > 0;
  if (anyStored) {
    hydrateStore({
      banks: b.rows.map((r) => r.data), admins: a.rows.map((r) => r.data), customers: c.rows.map((r) => r.data),
      transactions: t.rows.map((r) => r.data), audit: au.rows.map((r) => r.data),
    });
  } else {
    // First start on an empty database: persist whatever the store began with (the demo bank in development, nothing in production).
    const { Banks } = await import('./store.js');
    for (const bank of Banks.findAll()) {
      await db.query(`INSERT INTO bwl_banks (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [bank.id, JSON.stringify(bank)]);
    }
  }

  setStoreSink({
    bank: (x) => void persist('bank', () => db.query(
      `INSERT INTO bwl_banks (id, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`, [x.id, JSON.stringify(x)])),
    bankRemoved: (id) => void persist('bank removal', () => db.query(`DELETE FROM bwl_banks WHERE id = $1`, [id])),
    admin: (x) => void persist('admin', () => db.query(
      `INSERT INTO bwl_admins (id, bank_id, email, data, updated_at) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, email = EXCLUDED.email, updated_at = NOW()`,
      [x.id, x.bankId, x.email, JSON.stringify(x)])),
    customer: (x) => void persist('customer', () => db.query(
      `INSERT INTO bwl_customers (id, bank_id, data, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`, [x.id, x.bankId, JSON.stringify(x)])),
    transaction: (x) => void persist('transaction', () => db.query(
      `INSERT INTO bwl_transactions (id, bank_id, customer_id, created_at, data, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [x.id, x.bankId, x.customerId, x.createdAt, JSON.stringify(x)])),
    audit: (x) => void persist('audit entry', () => db.query(
      `INSERT INTO bwl_audit (id, bank_id, at, data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [x.id, x.bankId, x.timestamp, JSON.stringify(x)])),
  });
}

/** Test helper. */
export function detachPersistence(): void {
  setStoreSink(null);
}

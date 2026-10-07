/**
 * Durable reports.
 *
 * Generated reports (cash flow, netting, audit trail, yield income, tax filing packets) lived only in memory, so a restart lost
 * every one and with it the record of what was produced and handed to a filer or auditor. Now each report is written through to
 * Postgres and the most recent ones are loaded back at start. Older ones stay in the database and are fetched on demand.
 *
 * Configure with DATABASE_URL or DB_HOST. With neither it runs in memory (development); in production it refuses to start
 * without one. A write that fails after its retries is counted (persistenceFailures, shown on /health), never silent. A crash in
 * the milliseconds before a write lands can still drop that one report.
 */

import { Pool } from 'pg';
import type { ReportMetadata, ReportPayload } from './types';
import { hydrateReports, setReportSink, type StoredReport } from './store';

export const HYDRATE_LIMIT = 1000;
const MAX_ATTEMPTS = 3;

export function isDbEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env['DATABASE_URL'] || env['DB_HOST']);
}

export function assertPersistenceConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env['NODE_ENV'] === 'production' && !isDbEnabled(env)) {
    throw new Error(
      'Institutional reporting refuses to start in production without a database (set DATABASE_URL or DB_HOST): ' +
      'without one every generated report is lost on restart.',
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
    pool.on('error', (err) => console.error('[institutional-reporting] postgres pool error', err));
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
        console.error(`[institutional-reporting] failed to persist ${what}:`, e);
        return;
      }
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
}

export async function runMigrations(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS generated_reports (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL,
      size_bytes INTEGER NOT NULL,
      metadata JSONB NOT NULL,
      payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_generated_reports_at ON generated_reports(generated_at DESC);
  `);
}

/** One report straight from the database (for ones older than what was loaded at start). */
export async function fetchStoredReport(id: string): Promise<StoredReport | undefined> {
  if (!isDbEnabled()) return undefined;
  const res = await getPool().query<{ metadata: ReportMetadata; payload: ReportPayload }>(
    `SELECT metadata, payload FROM generated_reports WHERE id = $1`, [id],
  );
  const row = res.rows[0];
  return row ? { metadata: row.metadata, payload: row.payload } : undefined;
}

/** Remove a report from storage. True if a stored row was deleted. Awaited by the route, so a delete is not lost to a restart. */
export async function removeStoredReport(id: string): Promise<boolean> {
  if (!isDbEnabled()) return false;
  const res = await getPool().query(`DELETE FROM generated_reports WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

/** Remove every stored report. Development and tests only; the route refuses it in production. */
export async function clearStoredReports(): Promise<void> {
  if (!isDbEnabled()) return;
  await getPool().query(`TRUNCATE generated_reports`);
}

/** Migrate, load the most recent reports back into memory, and start writing changes through. Call before listening. */
export async function initPersistence(): Promise<void> {
  assertPersistenceConfigured();
  if (!isDbEnabled()) return;
  const db = getPool();
  await runMigrations();

  const res = await db.query<{ metadata: ReportMetadata; payload: ReportPayload }>(
    `SELECT metadata, payload FROM generated_reports ORDER BY generated_at DESC LIMIT $1`, [HYDRATE_LIMIT],
  );
  hydrateReports(res.rows.map((r) => ({ metadata: r.metadata, payload: r.payload })));

  setReportSink({
    save: (id, metadata, payload) => void persist('report', () => db.query(
      `INSERT INTO generated_reports (id, type, generated_at, size_bytes, metadata, payload)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [id, metadata.type, metadata.generatedAt, metadata.sizeBytes, JSON.stringify(metadata), JSON.stringify(payload)])),
  });
}

/** Test helper. */
export function detachPersistence(): void {
  setReportSink(null);
}

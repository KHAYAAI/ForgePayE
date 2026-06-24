/**
 * DB Migration Runner — accounts-service
 *
 * Reads all *.sql files from src/db/migrations/ in alphabetical order and
 * applies any that have not yet been recorded in the accounts_service_migrations
 * tracking table.  Idempotent — safe to run on every startup.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function findMigrationsDir(): Promise<string> {
  const candidates = [
    join(__dirname, 'migrations'),
    join(__dirname, '..', 'src', 'db', 'migrations'),
  ];

  for (const candidate of candidates) {
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      // not found, try next
    }
  }

  throw new Error(
    `[accounts-service] Cannot locate migrations directory. Tried: ${candidates.join(', ')}`,
  );
}

/**
 * Creates the migration tracking table if it does not already exist.
 */
async function ensureMigrationsTable(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS accounts_service_migrations (
      id          SERIAL       PRIMARY KEY,
      filename    TEXT         NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Returns the set of migration filenames that have already been applied.
 */
async function appliedMigrations(db: Pool): Promise<Set<string>> {
  const result = await db.query<{ filename: string }>(
    `SELECT filename FROM accounts_service_migrations ORDER BY id`,
  );
  return new Set(result.rows.map((r) => r.filename));
}

/**
 * Applies a single SQL migration inside a transaction and records it.
 */
async function applyMigration(db: Pool, filename: string, sql: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO accounts_service_migrations (filename) VALUES ($1)`,
      [filename],
    );
    await client.query('COMMIT');
    console.log(`[accounts-service] Migration applied: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`[accounts-service] Migration failed (${filename}): ${err}`);
  } finally {
    client.release();
  }
}

/**
 * Main entry point.  Call once during service startup before any DB queries.
 *
 * @param db  Shared pg.Pool instance.
 */
export async function runMigrations(db: Pool): Promise<void> {
  await ensureMigrationsTable(db);

  const migrationsDir = await findMigrationsDir();
  const allFiles      = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort(); // alphabetical = numeric order for 001_, 002_, …

  const applied = await appliedMigrations(db);

  const pending = allFiles.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('[accounts-service] No pending migrations.');
    return;
  }

  console.log(`[accounts-service] Applying ${pending.length} migration(s): ${pending.join(', ')}`);

  for (const filename of pending) {
    const sql = await readFile(join(migrationsDir, filename), 'utf8');
    await applyMigration(db, filename, sql);
  }

  console.log('[accounts-service] All migrations applied.');
}

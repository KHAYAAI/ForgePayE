/**
 * DB Migration Runner
 *
 * Reads all *.sql files from src/db/migrations/ in alphabetical order and
 * applies any that have not yet been recorded in the chain_sync_migrations
 * tracking table.  Idempotent — safe to run on every startup.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

// Resolve the migrations directory relative to this file regardless of CWD.
// In the compiled output (dist/) this file lives at dist/db/migrate.js and
// migrations are copied to src/db/migrations/ (see Dockerfile COPY step).
// We therefore look for migrations in both places and use whichever exists.
const __dirname = dirname(fileURLToPath(import.meta.url));

async function findMigrationsDir(): Promise<string> {
  // Possible locations: next to this file (dev/tsx), or at project-root/src/db/migrations (Docker).
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
    `[chain-sync] Cannot locate migrations directory. Tried: ${candidates.join(', ')}`,
  );
}

/**
 * Creates the migration tracking table if it does not already exist.
 */
async function ensureMigrationsTable(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS chain_sync_migrations (
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
    `SELECT filename FROM chain_sync_migrations ORDER BY id`,
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
      `INSERT INTO chain_sync_migrations (filename) VALUES ($1)`,
      [filename],
    );
    await client.query('COMMIT');
    console.log(`[chain-sync] Migration applied: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`[chain-sync] Migration failed (${filename}): ${err}`);
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
    console.log('[chain-sync] No pending migrations.');
    return;
  }

  console.log(`[chain-sync] Applying ${pending.length} migration(s): ${pending.join(', ')}`);

  for (const filename of pending) {
    const sql = await readFile(join(migrationsDir, filename), 'utf8');
    await applyMigration(db, filename, sql);
  }

  console.log('[chain-sync] All migrations applied.');
}

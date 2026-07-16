/**
 * ForgePay Console — database migration runner.
 * Applies lib/schema.sql against DATABASE_URL. Idempotent.
 *
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs
 * or: npm run db:migrate
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, '..', 'lib', 'schema.sql'), 'utf8');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set — nothing to migrate.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

try {
  await pool.query(sql);
  console.log('✓ ForgePay console schema applied.');
} catch (err) {
  console.error('✗ Migration failed:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}

/**
 * Database URL initialization for Prisma
 * ──────────────────────────────────────────────────────────────────────────
 * Constructs DATABASE_URL from individual DB_* environment variables
 * for Prisma ORM initialization.
 */

/**
 * Initialize DATABASE_URL from DB_* environment variables if not already set.
 * Call this at application startup before initializing Prisma client.
 */
export function initDatabaseUrl(): void {
  // If DATABASE_URL is already set, use it as-is
  if (process.env['DATABASE_URL']) {
    return;
  }

  // SECURITY: never fall back to the well-known dev password in production.
  if (!process.env['DB_PASSWORD'] && process.env['NODE_ENV'] === 'production') {
    throw new Error('[bank-connectivity] DATABASE_URL or DB_PASSWORD env var is required in production');
  }

  // Construct from individual DB_* variables
  const host = process.env['DB_HOST'] ?? 'localhost';
  const port = process.env['DB_PORT'] ?? '5432';
  const user = process.env['DB_USER'] ?? 'forgepay';
  const password = process.env['DB_PASSWORD'] ?? 'devpassword';
  const database = process.env['DB_NAME'] ?? 'forgepay';

  // Build PostgreSQL connection string
  // Note: Prisma uses DATABASE_URL for connection pooling configuration
  // Pool settings (DB_POOL_MAX, DB_POOL_MIN, etc.) are not directly used by Prisma
  // but can be configured in prisma/schema.prisma or via datasource extensions
  const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}`;

  process.env['DATABASE_URL'] = databaseUrl;
}

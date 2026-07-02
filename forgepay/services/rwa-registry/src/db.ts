/**
 * PostgreSQL pool + migrations for RWA Registry NAV cache.
 *
 * Tables:
 *   rwa_nav_cache     — cached NAV prices for RWA assets (1-hour TTL)
 */

import { Pool } from 'pg';

// SECURITY: the dev connection string (well-known password) must never reach production.
if (!process.env['DATABASE_URL'] && process.env['NODE_ENV'] === 'production') {
  throw new Error('[rwa-registry] DATABASE_URL env var is required in production');
}

export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://forgepay:devpassword@localhost:5432/forgepay_dev',
  max: 10,
});

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS rwa_nav_cache (
        asset               TEXT        PRIMARY KEY,
        price_usd           NUMERIC(20, 8) NOT NULL,
        fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at          TIMESTAMPTZ NOT NULL,
        source              TEXT        NOT NULL DEFAULT 'coingecko',
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_rwa_nav_cache_asset ON rwa_nav_cache(asset);
      CREATE INDEX IF NOT EXISTS idx_rwa_nav_cache_expires ON rwa_nav_cache(expires_at DESC);
    `);
  } finally {
    client.release();
  }
}

/**
 * Get cached NAV price for an asset if it exists and is not expired.
 */
export async function getCachedNAV(asset: string): Promise<number | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT price_usd FROM rwa_nav_cache
       WHERE asset = $1 AND expires_at > NOW()
       ORDER BY fetched_at DESC LIMIT 1`,
      [asset]
    );
    if (result.rows.length === 0) return null;
    return parseFloat(result.rows[0].price_usd);
  } finally {
    client.release();
  }
}

/**
 * Cache a NAV price with a 1-hour TTL.
 */
export async function cacheNAV(asset: string, priceUsd: number): Promise<void> {
  const client = await pool.connect();
  try {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour TTL
    await client.query(
      `INSERT INTO rwa_nav_cache (asset, price_usd, fetched_at, expires_at, source, updated_at)
       VALUES ($1, $2, NOW(), $3, 'coingecko', NOW())
       ON CONFLICT (asset) DO UPDATE SET
         price_usd = $2,
         fetched_at = NOW(),
         expires_at = $3,
         source = 'coingecko',
         updated_at = NOW()`,
      [asset, priceUsd, expiresAt]
    );
  } finally {
    client.release();
  }
}

/**
 * Get all cached NAVs (for initialization on startup).
 */
export async function getAllCachedNAVs(): Promise<Record<string, number>> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT asset, price_usd FROM rwa_nav_cache
       WHERE expires_at > NOW()
       ORDER BY fetched_at DESC`
    );
    const navMap: Record<string, number> = {};
    for (const row of result.rows) {
      navMap[row.asset] = parseFloat(row.price_usd);
    }
    return navMap;
  } finally {
    client.release();
  }
}

/**
 * Clear expired NAV cache entries.
 */
export async function clearExpiredNAVs(): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `DELETE FROM rwa_nav_cache WHERE expires_at <= NOW()`
    );
    return result.rowCount ?? 0;
  } finally {
    client.release();
  }
}

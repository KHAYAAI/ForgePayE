-- RWA Registry NAV Cache Migration
-- Creates table for caching real-time asset prices from CoinGecko

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

-- Comment: 1-hour TTL for real market data with automatic expiration

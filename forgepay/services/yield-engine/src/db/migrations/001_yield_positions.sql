-- Migration 001: Create yield_positions table
-- Persists DeFi position records with on-chain deployment metadata.

CREATE TABLE IF NOT EXISTS yield_positions (
  id UUID PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  principal NUMERIC(20, 6) NOT NULL,
  shares NUMERIC(20, 6) NOT NULL,
  current_value NUMERIC(20, 6) NOT NULL,
  unrealized_yield NUMERIC(20, 6) NOT NULL DEFAULT 0,
  realized_yield NUMERIC(20, 6) NOT NULL DEFAULT 0,
  deposited_at TIMESTAMPTZ NOT NULL,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawing', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yield_positions_merchant_id ON yield_positions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_yield_positions_vault_id ON yield_positions(vault_id);
CREATE INDEX IF NOT EXISTS idx_yield_positions_status ON yield_positions(status);
CREATE INDEX IF NOT EXISTS idx_yield_positions_last_updated_at ON yield_positions(last_updated_at DESC);

-- Migration 001b: Create yield_transactions table
-- Immutable ledger of all on-chain and off-chain operations.

CREATE TABLE IF NOT EXISTS yield_transactions (
  id UUID PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  position_id UUID NOT NULL REFERENCES yield_positions(id),
  type VARCHAR(32) NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'yield_accrual', 'auto_sweep')),
  amount NUMERIC(20, 6) NOT NULL,
  asset VARCHAR(10) NOT NULL CHECK (asset IN ('USDC', 'USDT', 'DAI', 'USDY', 'USTB')),
  tx_hash VARCHAR(255),
  chain VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yield_transactions_merchant_id ON yield_transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_yield_transactions_position_id ON yield_transactions(position_id);
CREATE INDEX IF NOT EXISTS idx_yield_transactions_type ON yield_transactions(type);
CREATE INDEX IF NOT EXISTS idx_yield_transactions_status ON yield_transactions(status);
CREATE INDEX IF NOT EXISTS idx_yield_transactions_created_at ON yield_transactions(created_at DESC);

-- Migration 001c: Create sweep_configs table
-- Persists per-merchant auto-sweep configuration.

CREATE TABLE IF NOT EXISTS sweep_configs (
  merchant_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  idle_threshold_usd NUMERIC(20, 2) NOT NULL DEFAULT 1000,
  target_vault_id TEXT NOT NULL,
  keep_reserve_usd NUMERIC(20, 2) NOT NULL DEFAULT 5000,
  auto_compound BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sweep_configs_enabled ON sweep_configs(enabled);

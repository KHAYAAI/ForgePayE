-- Chain Events Schema (Phase 3: On-chain ZK Contract Sync)
-- ─────────────────────────────────────────────────────────────────────────────
-- These tables are written by the chain-sync service when it detects
-- on-chain events from NullifierRegistry and CommitmentTree contracts.
--
-- chain_events:     append-only log of all on-chain ZK events
-- merkle_tree_state: current Merkle root per chain (mutable, one row per chain)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Chain Events Log ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chain_events (
  id             UUID          NOT NULL DEFAULT gen_random_uuid(),
  chain          VARCHAR(32)   NOT NULL,               -- 'ethereum' | 'polygon' | 'base' | 'arbitrum'
  block_number   BIGINT        NOT NULL,
  tx_hash        VARCHAR(66)   NOT NULL,               -- 0x-prefixed, 32 bytes = 66 chars
  event_type     VARCHAR(64)   NOT NULL,               -- 'merkle_root_updated' | 'nullifier_spent' | 'nullifier_frozen'

  -- Merkle root update fields (populated for event_type = 'merkle_root_updated')
  version        BIGINT,
  new_root       VARCHAR(66),                          -- bytes32 as 0x-prefixed hex
  prev_root      VARCHAR(66),
  leaf_count     BIGINT,

  -- Nullifier fields (populated for nullifier_* events)
  nullifier      VARCHAR(66),                          -- bytes32 as 0x-prefixed hex
  merkle_root    VARCHAR(66),
  amount_units   NUMERIC(38, 0),                       -- uint256-compatible (USDC: 6 decimals)

  -- Freeze fields (populated for event_type = 'nullifier_frozen')
  reason         TEXT,

  -- Metadata
  occurred_at    TIMESTAMPTZ   NOT NULL,               -- from on-chain block timestamp
  processed_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(), -- when chain-sync processed it

  CONSTRAINT chain_events_pkey PRIMARY KEY (id),
  -- Dedup: one row per (chain, tx_hash, event_type)
  CONSTRAINT chain_events_unique UNIQUE (chain, tx_hash, event_type)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_chain_events_chain_type
  ON chain_events (chain, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_chain_events_nullifier
  ON chain_events (nullifier)
  WHERE nullifier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chain_events_block
  ON chain_events (chain, block_number DESC);

COMMENT ON TABLE chain_events IS
  'Append-only log of on-chain ZK proof events from NullifierRegistry and CommitmentTree contracts. '
  'Written by chain-sync service. Never UPDATE or DELETE rows.';

-- ── Merkle Tree State ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS merkle_tree_state (
  chain          VARCHAR(32)   NOT NULL,               -- 'ethereum' | 'polygon' | 'base' | 'arbitrum'
  version        BIGINT        NOT NULL DEFAULT 0,     -- CommitmentTree.currentVersion()
  current_root   VARCHAR(66)   NOT NULL,               -- CommitmentTree.currentRoot()
  leaf_count     BIGINT        NOT NULL DEFAULT 0,     -- CommitmentTree.leafCount()
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT merkle_tree_state_pkey PRIMARY KEY (chain)
);

COMMENT ON TABLE merkle_tree_state IS
  'Current Merkle tree root per chain as synced from CommitmentTree contract. '
  'One row per chain. Updated by chain-sync whenever RootUpdated event is received. '
  'If this diverges from on-chain state, it indicates a sync bug or attack.';

-- Initialize with zero root for each chain
INSERT INTO merkle_tree_state (chain, version, current_root, leaf_count)
VALUES
  ('ethereum', 0, '0x0000000000000000000000000000000000000000000000000000000000000000', 0),
  ('polygon',  0, '0x0000000000000000000000000000000000000000000000000000000000000000', 0),
  ('base',     0, '0x0000000000000000000000000000000000000000000000000000000000000000', 0),
  ('arbitrum', 0, '0x0000000000000000000000000000000000000000000000000000000000000000', 0)
ON CONFLICT (chain) DO NOTHING;

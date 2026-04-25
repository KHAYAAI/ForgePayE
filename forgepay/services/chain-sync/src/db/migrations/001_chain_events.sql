-- chain_events: canonical log of all on-chain events from ZK contracts
CREATE TABLE IF NOT EXISTS chain_events (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  chain         TEXT         NOT NULL CHECK (chain IN ('ethereum', 'polygon', 'base', 'arbitrum')),
  block_number  BIGINT       NOT NULL,
  tx_hash       TEXT         NOT NULL,
  event_type    TEXT         NOT NULL CHECK (event_type IN ('merkle_root_updated', 'nullifier_spent', 'nullifier_frozen', 'commitment_inserted')),
  -- merkle_root_updated fields
  version       TEXT,        -- uint256 tree version
  new_root      TEXT,        -- bytes32 hex
  prev_root     TEXT,        -- bytes32 hex
  leaf_count    TEXT,        -- uint256 as string
  -- nullifier fields
  nullifier     TEXT,        -- bytes32 hex
  merkle_root   TEXT,        -- bytes32 hex for payment confirmed
  amount_units  TEXT,        -- uint256 as string for payment confirmed
  -- nullifier_frozen fields
  reason        TEXT,
  occurred_at   TIMESTAMPTZ  NOT NULL,
  indexed_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (chain, tx_hash, event_type)
);

CREATE INDEX IF NOT EXISTS ix_chain_events_chain_block ON chain_events (chain, block_number DESC);
CREATE INDEX IF NOT EXISTS ix_chain_events_nullifier ON chain_events (nullifier) WHERE nullifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_chain_events_event_type ON chain_events (event_type, chain);

-- merkle_tree_state: latest known Merkle root per chain (synchronized from CommitmentTree)
CREATE TABLE IF NOT EXISTS merkle_tree_state (
  chain         TEXT         PRIMARY KEY,
  version       TEXT         NOT NULL DEFAULT '0',
  current_root  TEXT         NOT NULL DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000',
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Insert initial rows for all supported chains
INSERT INTO merkle_tree_state (chain) VALUES ('ethereum'), ('polygon'), ('base'), ('arbitrum')
  ON CONFLICT (chain) DO NOTHING;

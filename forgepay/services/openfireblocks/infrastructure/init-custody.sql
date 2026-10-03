-- Custody governance layer: connected applications, signer roster, quorum
-- proposals and votes. Idempotent. Apply after init-db.sql and init-phase1.sql.

CREATE SCHEMA IF NOT EXISTS custody;

-- Per-customer quorum settings. `threshold` is how many active signers must
-- approve a proposal; it is capped at the active roster size when evaluated.
CREATE TABLE IF NOT EXISTS custody.settings (
  customer_id        VARCHAR(255) PRIMARY KEY,
  threshold          INTEGER NOT NULL DEFAULT 2 CHECK (threshold >= 1),
  cooling_off_hours  INTEGER NOT NULL DEFAULT 24 CHECK (cooling_off_hours >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API keys for applications integrating with a customer's custody. Unlike
-- customers.api_key (one per customer, shown once at provisioning), a customer
-- can hold many of these, name them, and revoke them individually.
CREATE TABLE IF NOT EXISTS custody.api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  key_prefix    VARCHAR(16)  NOT NULL,
  key_hash      VARCHAR(255) NOT NULL UNIQUE,
  created_by    VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_custody_api_keys_customer ON custody.api_keys(customer_id);

-- People whose approval counts. A signer's vote only counts once
-- active_from has passed (the cooling-off period after being added).
CREATE TABLE IF NOT EXISTS custody.signers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  VARCHAR(255) NOT NULL,
  email        VARCHAR(255) NOT NULL,
  name         VARCHAR(255),
  status       VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  added_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  active_from  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  removed_at   TIMESTAMPTZ,
  UNIQUE (customer_id, email)
);

-- Anything that needs quorum: roster changes, threshold changes, and
-- transfers the policy engine flagged as requiring approval.
CREATE TABLE IF NOT EXISTS custody.proposals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  VARCHAR(255) NOT NULL,
  kind         VARCHAR(40)  NOT NULL CHECK (kind IN ('add_signer', 'remove_signer', 'set_threshold', 'rotate_key', 'approve_transaction', 'set_signer_key')),
  payload      JSONB        NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'executed', 'rejected', 'failed')),
  required     INTEGER      NOT NULL,
  request_id   UUID,
  created_by   VARCHAR(255) NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  decided_at   TIMESTAMPTZ,
  result       JSONB
);
CREATE INDEX IF NOT EXISTS idx_custody_proposals_customer ON custody.proposals(customer_id, status);

-- One vote per signer per proposal, enforced by the primary key.
CREATE TABLE IF NOT EXISTS custody.votes (
  proposal_id  UUID NOT NULL REFERENCES custody.proposals(id),
  signer_id    UUID NOT NULL REFERENCES custody.signers(id),
  approve      BOOLEAN NOT NULL,
  voted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (proposal_id, signer_id)
);

-- One signing key per workspace. With threshold signing this row is all the
-- gateway knows about a key: its public address and which nodes hold shares.
-- The shares themselves live only on the signing nodes.
CREATE TABLE IF NOT EXISTS custody.keys (
  key_id       TEXT PRIMARY KEY,
  customer_id  VARCHAR(255) NOT NULL,
  address      VARCHAR(64)  NOT NULL,
  public_key   TEXT         NOT NULL,
  scheme       VARCHAR(40)  NOT NULL,
  threshold    INTEGER      NOT NULL,   -- t: any t+1 nodes sign
  nodes        TEXT[]       NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- At most one active key per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS idx_custody_keys_active ON custody.keys(customer_id) WHERE status = 'active';

-- Backfill support: when a workspace's first threshold key is created after it
-- had already signed with the old shared signer key, the shared key's address
-- is recorded here. Nothing is deleted or rewritten; the history stays as it
-- was, and this column says which address signed it. NULL = no legacy history.
ALTER TABLE custody.keys ADD COLUMN IF NOT EXISTS legacy_signer_address VARCHAR(64);

-- Broadcast lifecycle on signing.transactions. status values in use:
--   pending_approval -> (signed | broadcasting) -> broadcasted -> confirmed
--   broadcasting -> signed_not_broadcast (RPC refused/unreachable; Rebroadcast resends the SAME signed bytes)
--   broadcasted  -> stuck (no receipt after TX_STUCK_AFTER_MS; never auto-replaced) | failed (reverted)
--   signed = signed with no network RPC configured (signing only)
ALTER TABLE signing.transactions
  ADD COLUMN IF NOT EXISTS from_address  VARCHAR(64),   -- the key address that signed it (nonce owner)
  ADD COLUMN IF NOT EXISTS chain_id      BIGINT,
  ADD COLUMN IF NOT EXISTS broadcast_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS block_number  BIGINT,
  ADD COLUMN IF NOT EXISTS status_detail TEXT;          -- broadcast error / failure / stuck reason
CREATE INDEX IF NOT EXISTS idx_tx_from_nonce ON signing.transactions (lower(from_address), nonce);

-- Key rotation (resharing). epoch counts reshares; threshold/nodes above always
-- describe the *current* committee. The address never changes.
ALTER TABLE custody.keys
  ADD COLUMN IF NOT EXISTS epoch      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;

-- Existing databases: allow the rotate_key proposal kind (the CREATE above only applies to new ones).
ALTER TABLE custody.proposals DROP CONSTRAINT IF EXISTS proposals_kind_check;
ALTER TABLE custody.proposals ADD CONSTRAINT proposals_kind_check
  CHECK (kind IN ('add_signer', 'remove_signer', 'set_threshold', 'rotate_key', 'approve_transaction'));

-- Per-signer cryptographic approval. Each signer's own Ed25519 public key (hex); a vote carries the signer's signature
-- over the exact proposal, and is only counted when it verifies against this key. Idempotent.
ALTER TABLE custody.signers ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE custody.votes ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE custody.votes ADD COLUMN IF NOT EXISTS signed_digest TEXT;
ALTER TABLE custody.proposals DROP CONSTRAINT IF EXISTS proposals_kind_check;
ALTER TABLE custody.proposals ADD CONSTRAINT proposals_kind_check
  CHECK (kind IN ('add_signer', 'remove_signer', 'set_threshold', 'rotate_key', 'approve_transaction', 'set_signer_key'));

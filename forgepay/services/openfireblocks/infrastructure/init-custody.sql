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
  kind         VARCHAR(40)  NOT NULL CHECK (kind IN ('add_signer', 'remove_signer', 'set_threshold', 'approve_transaction')),
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

-- ForgePay Accounts Service — Schema
-- Multi-tenant: merchant_id on all tables for tenant isolation
-- All monetary amounts stored as NUMERIC for precision (no floating point)

-- ── Stablecoin-Backed Accounts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fp_accounts (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     TEXT          NOT NULL,
  account_number  TEXT          NOT NULL UNIQUE,  -- e.g. "FP-2026-00001"
  email           TEXT          NOT NULL,
  display_name    TEXT,
  kyc_status      TEXT          NOT NULL DEFAULT 'not_started'
                                CHECK (kyc_status IN ('not_started','pending','approved','rejected','requires_review')),
  risk_score      NUMERIC(4,3)  NOT NULL DEFAULT 0.1,
  balance_usdc    NUMERIC(20,6) NOT NULL DEFAULT 0,
  balance_usdt    NUMERIC(20,6) NOT NULL DEFAULT 0,
  default_chain   TEXT          NOT NULL DEFAULT 'polygon',
  wallet_address  TEXT,
  encrypted_key   TEXT,         -- AES-256-GCM encrypted private key (JSON blob)
  metadata        JSONB,
  is_active       BOOLEAN       NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fp_accounts_merchant_id     ON fp_accounts (merchant_id);
CREATE INDEX IF NOT EXISTS ix_fp_accounts_email           ON fp_accounts (email);
CREATE INDEX IF NOT EXISTS ix_fp_accounts_wallet_address  ON fp_accounts (wallet_address);
CREATE INDEX IF NOT EXISTS ix_fp_accounts_kyc_status      ON fp_accounts (merchant_id, kyc_status);

-- ── KYC Verifications ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fp_kyc_verifications (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID         NOT NULL REFERENCES fp_accounts(id) ON DELETE CASCADE,
  status               TEXT         NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','approved','rejected','requires_review')),
  onfido_applicant_id  TEXT,
  onfido_check_id      TEXT,
  risk_score           NUMERIC(4,3) NOT NULL DEFAULT 0.1,
  ofac_match           BOOLEAN      NOT NULL DEFAULT false,
  pep_match            BOOLEAN      NOT NULL DEFAULT false,
  rejection_reason     TEXT,
  first_name           TEXT         NOT NULL,
  last_name            TEXT         NOT NULL,
  date_of_birth        DATE,
  country              TEXT,
  raw_response         JSONB,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_fp_kyc_account_id ON fp_kyc_verifications (account_id);
CREATE INDEX IF NOT EXISTS ix_fp_kyc_onfido_check ON fp_kyc_verifications (onfido_check_id)
  WHERE onfido_check_id IS NOT NULL;

-- ── Deposits (USD/USDC inflow) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fp_deposits (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID          NOT NULL REFERENCES fp_accounts(id) ON DELETE CASCADE,
  merchant_id      TEXT          NOT NULL,
  amount_usd       NUMERIC(12,2) NOT NULL CHECK (amount_usd > 0),
  amount_units     TEXT          NOT NULL,  -- USDC units (6 decimals as string)
  chain            TEXT          NOT NULL DEFAULT 'polygon',
  deposit_address  TEXT          NOT NULL,
  circle_intent_id TEXT,
  status           TEXT          NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','processing','confirmed','failed')),
  tx_hash          TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  confirmed_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ   NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_fp_deposits_account_id  ON fp_deposits (account_id);
CREATE INDEX IF NOT EXISTS ix_fp_deposits_status      ON fp_deposits (status, expires_at);
CREATE INDEX IF NOT EXISTS ix_fp_deposits_merchant_id ON fp_deposits (merchant_id, created_at DESC);

-- ── Withdrawals (USDC/USD outflow) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fp_withdrawals (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID          NOT NULL REFERENCES fp_accounts(id) ON DELETE CASCADE,
  merchant_id       TEXT          NOT NULL,
  amount_usd        NUMERIC(12,2) NOT NULL CHECK (amount_usd > 0),
  fee_usd           NUMERIC(8,4)  NOT NULL DEFAULT 0,
  net_amount_usd    NUMERIC(12,2) NOT NULL,
  wire_details_enc  TEXT          NOT NULL,  -- AES-256-GCM encrypted wire details
  circle_payout_id  TEXT,
  status            TEXT          NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','processing','completed','failed')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_fp_withdrawals_account_id ON fp_withdrawals (account_id);
CREATE INDEX IF NOT EXISTS ix_fp_withdrawals_status     ON fp_withdrawals (status);

-- ── Transactions (unified ledger) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fp_account_transactions (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID          NOT NULL REFERENCES fp_accounts(id) ON DELETE CASCADE,
  merchant_id     TEXT          NOT NULL,
  type            TEXT          NOT NULL CHECK (type IN ('deposit','withdrawal','internal_transfer')),
  amount_usd      NUMERIC(12,2) NOT NULL,
  amount_units    TEXT          NOT NULL,
  token           TEXT          NOT NULL DEFAULT 'USDC' CHECK (token IN ('USDC','USDT')),
  chain           TEXT          NOT NULL,
  status          TEXT          NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','processing','completed','failed','blocked')),
  risk_score      NUMERIC(4,3),
  fraud_decision  TEXT          CHECK (fraud_decision IN ('allow','review','block')),
  -- Phase 2: ZK proof fields (null until ZK_PROOFS_ENABLED=true)
  zk_proof        TEXT,         -- base64 Groth16 proof
  commitment      TEXT,         -- 0x-prefixed hex commitment (Merkle tree leaf)
  tx_hash         TEXT,
  deposit_id      UUID          REFERENCES fp_deposits(id),
  withdrawal_id   UUID          REFERENCES fp_withdrawals(id),
  route_info      JSONB,        -- RouteDecision snapshot
  error_message   TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_fp_txns_account_id  ON fp_account_transactions (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_fp_txns_merchant_id ON fp_account_transactions (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_fp_txns_status      ON fp_account_transactions (status);
CREATE INDEX IF NOT EXISTS ix_fp_txns_type_status ON fp_account_transactions (account_id, type, status);

-- ── Down migration ─────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS fp_account_transactions;
-- DROP TABLE IF EXISTS fp_withdrawals;
-- DROP TABLE IF EXISTS fp_deposits;
-- DROP TABLE IF EXISTS fp_kyc_verifications;
-- DROP TABLE IF EXISTS fp_accounts;

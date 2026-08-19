-- ForgePay Merchant Dashboard — auth & session schema
-- Idempotent: safe to run repeatedly (CREATE TABLE IF NOT EXISTS + additive ALTERs).
-- Run via: npm run db:migrate  (apps/dashboard/scripts/migrate.mjs)

-- Merchants table — matches mor-layer registration (extended here for session/MFA/SSO)
CREATE TABLE IF NOT EXISTS merchants (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  api_key       TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SSO (WorkOS) — merchants in the same company (email domain) share an organization
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS workos_organization_id TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS workos_id TEXT;  -- User ID from WorkOS profile

CREATE INDEX IF NOT EXISTS idx_merchants_workos_org ON merchants(workos_organization_id) WHERE workos_organization_id IS NOT NULL;

-- MFA (TOTP). totp_secret is set on enrollment but totp_enabled stays false
-- until the merchant confirms one code — see lib/mfa.ts. backup_codes holds
-- sha256 hashes only, one-time use, cleared as they're consumed.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);

-- Sessions — every issued JWT carries a `jti` claim matching sessions.id.
-- getCurrentUser() checks this table on every request (not just the JWT
-- signature) so a session can be revoked before its 7-day expiry: "log out
-- everywhere", MFA being enabled/disabled, etc. See lib/auth.ts.
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  merchant_id   TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address    TEXT,
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_merchant ON sessions(merchant_id, revoked_at, expires_at);

-- Audit log — append-only. actor_email is denormalized so historical entries
-- stay readable. See lib/audit.ts.
CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  merchant_id    TEXT REFERENCES merchants(id) ON DELETE SET NULL,
  actor_merchant_id TEXT REFERENCES merchants(id) ON DELETE SET NULL,
  actor_email    TEXT,
  action         TEXT NOT NULL,
  resource       TEXT,
  detail         JSONB,
  ip_address     TEXT,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_merchant_time ON audit_log(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_merchant_id, created_at DESC);

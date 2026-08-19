-- ForgePay Merchant Dashboard — auth & session schema
-- Idempotent: safe to run repeatedly (CREATE TABLE IF NOT EXISTS + additive ALTERs).
-- Run via: npm run db:migrate  (apps/dashboard/scripts/migrate.mjs)

-- Merchants table — matches mor-layer registration (extended here for session/MFA/SSO)
-- api_key is nullable on purpose: mor-layer issues Hyperswitch keys, and a
-- merchant provisioned by an SSO first-login has no mor-layer record yet.
-- Such a merchant can sign in, but payment calls stay unauthorized until an
-- operator links the account — which is the honest failure. (Postgres allows
-- many NULLs under a UNIQUE constraint, so uniqueness still holds for real keys.)
CREATE TABLE IF NOT EXISTS merchants (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  api_key       TEXT UNIQUE,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pre-existing deployments created this column NOT NULL; SSO provisioning needs it nullable.
ALTER TABLE merchants ALTER COLUMN api_key DROP NOT NULL;

-- SSO (WorkOS) — merchants in the same company (email domain) share an organization
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS workos_organization_id TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS workos_id TEXT;  -- User ID from WorkOS profile

CREATE INDEX IF NOT EXISTS idx_merchants_workos_org ON merchants(workos_organization_id) WHERE workos_organization_id IS NOT NULL;

-- MFA (TOTP), custodied by WorkOS — see lib/workos-mfa.ts.
--
-- workos_factor_id is an opaque handle to a factor WorkOS holds the secret
-- for; we never store the shared secret ourselves, so a dump of this table
-- cannot be used to mint anyone's codes. mfa_enabled stays false between
-- enrollment and the merchant confirming their first code, so a half-finished
-- enrollment can never lock someone out.
--
-- Backup codes stay local: WorkOS has no backup-code primitive, and a
-- merchant who loses their authenticator otherwise has no way back in. Stored
-- as sha256 hashes only, one-time use, removed from the array as consumed.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS workos_factor_id TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT[] NOT NULL DEFAULT '{}';

-- Pre-WorkOS deployments stored a local TOTP secret. Drop it: leaving a
-- column of live shared secrets behind is precisely the exposure moving to
-- WorkOS-custodied factors was meant to remove. Merchants enrolled under the
-- old scheme re-enroll (mfa_enabled defaults false, so they are not locked out).
ALTER TABLE merchants DROP COLUMN IF EXISTS totp_secret;
ALTER TABLE merchants DROP COLUMN IF EXISTS totp_enabled;

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

-- Email domain → WorkOS organization.
--
-- The SSO handshake must name a connection, organization, or provider; there
-- is no "route by email domain" parameter (WorkOS removed it), so the mapping
-- lives here. An operator adds a row when onboarding an enterprise, using the
-- organization id from the WorkOS dashboard.
--
-- Without a row for their domain, a merchant simply has no SSO option and
-- signs in with password + MFA as usual.
CREATE TABLE IF NOT EXISTS sso_domains (
  domain                  TEXT PRIMARY KEY,
  workos_organization_id  TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SSO hand-off tickets.
--
-- WorkOS authenticates the merchant against their IdP, but the session this
-- app issues is a NextAuth one, and NextAuth's credentials provider is the
-- only thing that can mint it. Rather than have the SSO callback forge a
-- cookie NextAuth doesn't recognise (which logs nobody in), it records a
-- single-use ticket here and redirects; the login page spends the ticket
-- through the normal credentials flow.
--
-- Single-use and short-lived by construction: consumed_at is set on
-- redemption and a spent or expired ticket is refused, so a ticket leaked
-- through a referrer header or browser history is inert.
CREATE TABLE IF NOT EXISTS sso_tickets (
  id           TEXT PRIMARY KEY,
  merchant_id  TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sso_tickets_merchant ON sso_tickets(merchant_id);

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

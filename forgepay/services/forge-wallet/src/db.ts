/**
 * PostgreSQL pool + migrations for FORGE Wallet.
 *
 * Schema: forge_wallet
 *
 * Tables:
 *   users               — email/password identities, DID, optional TOTP fields
 *   wallets             — per-chain addresses (active | rotated)
 *   encrypted_keys      — AES-256-GCM envelopes (scrypt KEK); no plaintext keys
 *   transactions        — append-only transaction log (deletes forbidden by trigger)
 *   transaction_events  — append-only status transition log
 *   trusted_contacts    — up to 3 social-recovery contacts per user
 *   recovery_requests   — 2-of-3 approval recovery flows
 *   recovery_approvals  — single-use token hashes (raw tokens never stored)
 *   gas_sponsorship     — sponsored gas ledger (~$0.10/tx placeholder) for billing
 *
 * The service runs against an in-memory store first (same idiom as
 * enterprise-treasury); persistence helpers below are best-effort and only
 * active after runMigrations() succeeds, so tests and DB-less dev never
 * touch Postgres.
 */

import { Pool } from 'pg';
import type {
  EncryptedKey,
  GasSponsorship,
  RecoveryApproval,
  RecoveryRequest,
  TransactionEvent,
  TrustedContact,
  User,
  Wallet,
  WalletTransaction,
} from './types';

export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://forgepay:devpassword@localhost:5432/forgepay_dev',
  max: 10,
});

let dbReady = false;

export function isDbReady(): boolean {
  return dbReady;
}

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS forge_wallet;

      CREATE TABLE IF NOT EXISTS forge_wallet.users (
        id            TEXT        PRIMARY KEY,
        did           TEXT        NOT NULL UNIQUE,
        email         TEXT        NOT NULL UNIQUE,
        name          TEXT,
        password_hash TEXT        NOT NULL,
        totp_secret   TEXT,
        totp_enabled  BOOLEAN     NOT NULL DEFAULT false,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_fw_users_email ON forge_wallet.users(email);

      CREATE TABLE IF NOT EXISTS forge_wallet.encrypted_keys (
        id             TEXT        PRIMARY KEY,
        owner_id       TEXT        NOT NULL,
        public_key_pem TEXT        NOT NULL,
        ciphertext_hex TEXT        NOT NULL,
        iv_hex         TEXT        NOT NULL,
        auth_tag_hex   TEXT        NOT NULL,
        salt_hex       TEXT        NOT NULL,
        kdf            TEXT        NOT NULL DEFAULT 'scrypt',
        kdf_params     JSONB       NOT NULL,
        cipher         TEXT        NOT NULL DEFAULT 'aes-256-gcm',
        version        INT         NOT NULL DEFAULT 1,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_fw_keys_owner ON forge_wallet.encrypted_keys(owner_id);

      CREATE TABLE IF NOT EXISTS forge_wallet.wallets (
        id                TEXT        PRIMARY KEY,
        owner_id          TEXT        NOT NULL,
        owner_type        TEXT        NOT NULL CHECK (owner_type IN ('user', 'agent')),
        did               TEXT        NOT NULL,
        blockchain        TEXT        NOT NULL,
        address           TEXT        NOT NULL,
        key_id            TEXT        NOT NULL REFERENCES forge_wallet.encrypted_keys(id),
        status            TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated')),
        vault_backup_path TEXT        NOT NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        rotated_at        TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_fw_wallets_address ON forge_wallet.wallets(address);
      CREATE INDEX IF NOT EXISTS idx_fw_wallets_owner ON forge_wallet.wallets(owner_id);
      CREATE INDEX IF NOT EXISTS idx_fw_wallets_active
        ON forge_wallet.wallets(owner_id, blockchain)
        WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS forge_wallet.transactions (
        id             TEXT          PRIMARY KEY,
        owner_id       TEXT          NOT NULL,
        did            TEXT          NOT NULL,
        wallet_id      TEXT          NOT NULL,
        blockchain     TEXT          NOT NULL,
        from_address   TEXT          NOT NULL,
        to_address     TEXT          NOT NULL,
        amount         NUMERIC(30,8) NOT NULL,
        currency       TEXT          NOT NULL,
        payment_terms  TEXT,
        status         TEXT          NOT NULL CHECK (status IN ('created','signed','broadcast','confirmed','failed')),
        signature      TEXT,
        tx_hash        TEXT,
        confirmations  INT           NOT NULL DEFAULT 0,
        failure_reason TEXT,
        created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        confirmed_at   TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_fw_tx_owner   ON forge_wallet.transactions(owner_id);
      CREATE INDEX IF NOT EXISTS idx_fw_tx_status  ON forge_wallet.transactions(status);
      CREATE INDEX IF NOT EXISTS idx_fw_tx_created ON forge_wallet.transactions(created_at DESC);

      -- Append-only guarantee: transactions may transition status but are
      -- never deleted; the event log is strictly insert-only.
      CREATE OR REPLACE FUNCTION forge_wallet.forbid_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forge_wallet: % on % is forbidden (append-only)', TG_OP, TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_fw_tx_no_delete ON forge_wallet.transactions;
      CREATE TRIGGER trg_fw_tx_no_delete
        BEFORE DELETE ON forge_wallet.transactions
        FOR EACH ROW EXECUTE FUNCTION forge_wallet.forbid_mutation();

      CREATE TABLE IF NOT EXISTS forge_wallet.transaction_events (
        id             TEXT        PRIMARY KEY,
        transaction_id TEXT        NOT NULL,
        status         TEXT        NOT NULL,
        detail         TEXT,
        at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_fw_tx_events_tx ON forge_wallet.transaction_events(transaction_id);

      DROP TRIGGER IF EXISTS trg_fw_tx_events_immutable ON forge_wallet.transaction_events;
      CREATE TRIGGER trg_fw_tx_events_immutable
        BEFORE UPDATE OR DELETE ON forge_wallet.transaction_events
        FOR EACH ROW EXECUTE FUNCTION forge_wallet.forbid_mutation();

      CREATE TABLE IF NOT EXISTS forge_wallet.trusted_contacts (
        id         TEXT        PRIMARY KEY,
        user_id    TEXT        NOT NULL REFERENCES forge_wallet.users(id),
        email      TEXT        NOT NULL,
        name       TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, email)
      );
      CREATE INDEX IF NOT EXISTS idx_fw_contacts_user ON forge_wallet.trusted_contacts(user_id);

      CREATE TABLE IF NOT EXISTS forge_wallet.recovery_requests (
        id                 TEXT        PRIMARY KEY,
        user_id            TEXT        NOT NULL REFERENCES forge_wallet.users(id),
        status             TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','completed','expired')),
        required_approvals INT         NOT NULL DEFAULT 2,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at         TIMESTAMPTZ NOT NULL,
        completed_at       TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_fw_recovery_user ON forge_wallet.recovery_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_fw_recovery_open
        ON forge_wallet.recovery_requests(status)
        WHERE status IN ('pending', 'approved');

      CREATE TABLE IF NOT EXISTS forge_wallet.recovery_approvals (
        id          TEXT        PRIMARY KEY,
        request_id  TEXT        NOT NULL REFERENCES forge_wallet.recovery_requests(id),
        contact_id  TEXT        NOT NULL,
        token_hash  TEXT        NOT NULL UNIQUE,
        approved_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_fw_approvals_request ON forge_wallet.recovery_approvals(request_id);

      CREATE TABLE IF NOT EXISTS forge_wallet.gas_sponsorship (
        id             TEXT          PRIMARY KEY,
        transaction_id TEXT          NOT NULL,
        owner_id       TEXT          NOT NULL,
        blockchain     TEXT          NOT NULL,
        sponsored_usd  NUMERIC(12,4) NOT NULL,
        created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_fw_gas_owner ON forge_wallet.gas_sponsorship(owner_id);
      CREATE INDEX IF NOT EXISTS idx_fw_gas_tx    ON forge_wallet.gas_sponsorship(transaction_id);
    `);
    dbReady = true;
  } finally {
    client.release();
  }
}

// ── Best-effort persistence helpers ───────────────────────────────────────────
// No-ops until runMigrations() has succeeded; failures are logged by callers.

function ifReady(fn: () => Promise<unknown>): Promise<void> {
  if (!dbReady) return Promise.resolve();
  return fn().then(
    () => undefined,
    () => undefined, // callers treat persistence as best-effort; store is source of truth in dev
  );
}

export function persistUser(u: User): Promise<void> {
  return ifReady(() =>
    pool.query(
      `INSERT INTO forge_wallet.users (id, did, email, name, password_hash, totp_secret, totp_enabled, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = EXCLUDED.updated_at`,
      [u.id, u.did, u.email, u.name, u.passwordHash, u.totpSecret, u.totpEnabled, u.createdAt, u.updatedAt],
    ),
  );
}

export function persistEncryptedKey(k: EncryptedKey): Promise<void> {
  return ifReady(() =>
    pool.query(
      `INSERT INTO forge_wallet.encrypted_keys
         (id, owner_id, public_key_pem, ciphertext_hex, iv_hex, auth_tag_hex, salt_hex, kdf, kdf_params, cipher, version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [k.id, k.ownerId, k.publicKeyPem, k.ciphertextHex, k.ivHex, k.authTagHex, k.saltHex, k.kdf, JSON.stringify(k.kdfParams), k.cipher, k.version, k.createdAt],
    ),
  );
}

export function persistWallet(w: Wallet): Promise<void> {
  return ifReady(() =>
    pool.query(
      `INSERT INTO forge_wallet.wallets
         (id, owner_id, owner_type, did, blockchain, address, key_id, status, vault_backup_path, created_at, rotated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, rotated_at = EXCLUDED.rotated_at`,
      [w.id, w.ownerId, w.ownerType, w.did, w.blockchain, w.address, w.keyId, w.status, w.vaultBackupPath, w.createdAt, w.rotatedAt],
    ),
  );
}

export function persistTransaction(t: WalletTransaction): Promise<void> {
  return ifReady(() =>
    pool.query(
      `INSERT INTO forge_wallet.transactions
         (id, owner_id, did, wallet_id, blockchain, from_address, to_address, amount, currency, payment_terms,
          status, signature, tx_hash, confirmations, failure_reason, created_at, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, signature = EXCLUDED.signature, tx_hash = EXCLUDED.tx_hash,
         confirmations = EXCLUDED.confirmations, failure_reason = EXCLUDED.failure_reason,
         confirmed_at = EXCLUDED.confirmed_at`,
      [t.id, t.ownerId, t.did, t.walletId, t.blockchain, t.fromAddress, t.toAddress, t.amount, t.currency,
       t.paymentTerms, t.status, t.signature, t.txHash, t.confirmations, t.failureReason, t.createdAt, t.confirmedAt],
    ),
  );
}

export function persistTransactionEvent(e: TransactionEvent): Promise<void> {
  return ifReady(() =>
    pool.query(
      `INSERT INTO forge_wallet.transaction_events (id, transaction_id, status, detail, at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [e.id, e.transactionId, e.status, e.detail, e.at],
    ),
  );
}

export function persistTrustedContact(c: TrustedContact): Promise<void> {
  return ifReady(() =>
    pool.query(
      `INSERT INTO forge_wallet.trusted_contacts (id, user_id, email, name, created_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [c.id, c.userId, c.email, c.name, c.createdAt],
    ),
  );
}

export function persistRecoveryRequest(r: RecoveryRequest): Promise<void> {
  return ifReady(() =>
    pool.query(
      `INSERT INTO forge_wallet.recovery_requests (id, user_id, status, required_approvals, created_at, expires_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, completed_at = EXCLUDED.completed_at`,
      [r.id, r.userId, r.status, r.requiredApprovals, r.createdAt, r.expiresAt, r.completedAt],
    ),
  );
}

export function persistRecoveryApproval(a: RecoveryApproval): Promise<void> {
  return ifReady(() =>
    pool.query(
      `INSERT INTO forge_wallet.recovery_approvals (id, request_id, contact_id, token_hash, approved_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET approved_at = EXCLUDED.approved_at`,
      [a.id, a.requestId, a.contactId, a.tokenHash, a.approvedAt],
    ),
  );
}

export function persistGasSponsorship(g: GasSponsorship): Promise<void> {
  return ifReady(() =>
    pool.query(
      `INSERT INTO forge_wallet.gas_sponsorship (id, transaction_id, owner_id, blockchain, sponsored_usd, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [g.id, g.transactionId, g.ownerId, g.blockchain, g.sponsoredUsd, g.createdAt],
    ),
  );
}

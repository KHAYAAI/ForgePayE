import { queryOne, execute } from './db';

/**
 * Local projection of merchant identity.
 *
 * mor-layer is the system of record for *who a merchant is* (email, name,
 * bcrypt-hashed password, their own Hyperswitch api_key). This table is not a
 * second copy of that — it exists because the dashboard owns auth state
 * mor-layer has no concept of: revocable sessions, MFA factors, SSO linkage,
 * and the audit trail. Those all need a local row to hang off, and
 * `sessions.merchant_id` / `audit_log.merchant_id` are foreign keys to it.
 *
 * So every successful login mirrors the mor-layer identity into this table
 * first. Without that step session creation fails the FK outright for any
 * merchant who registered through mor-layer — which is all of them.
 *
 * Identity fields are refreshed from mor-layer on each login (it stays
 * authoritative); MFA and SSO columns are owned here and never overwritten.
 */

export interface MerchantIdentity {
  id: string;
  email: string;
  name: string;
  apiKey: string;
}

/**
 * Insert or refresh the local row for a merchant authenticated upstream.
 * Idempotent; safe on every login.
 */
export async function ensureLocalMerchant(identity: MerchantIdentity): Promise<void> {
  await execute(
    `INSERT INTO merchants (id, email, name, api_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE
       SET email      = EXCLUDED.email,
           name       = EXCLUDED.name,
           api_key    = EXCLUDED.api_key,
           updated_at = NOW()`,
    [identity.id, identity.email, identity.name, identity.apiKey],
  );
}

export interface MerchantRow {
  id: string;
  email: string;
  name: string;
  /** Null for merchants provisioned by an SSO first-login — see schema.sql. */
  api_key: string | null;
  status: string;
  workos_factor_id: string | null;
  mfa_enabled: boolean;
  workos_organization_id: string | null;
  workos_id: string | null;
}

export async function getMerchantById(id: string): Promise<MerchantRow | null> {
  return queryOne<MerchantRow>(`SELECT * FROM merchants WHERE id = $1`, [id]);
}

export async function getMerchantByEmail(email: string): Promise<MerchantRow | null> {
  return queryOne<MerchantRow>(`SELECT * FROM merchants WHERE email = $1`, [email]);
}

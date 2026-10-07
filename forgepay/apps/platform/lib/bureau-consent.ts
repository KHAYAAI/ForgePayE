/**
 * Consent for lender pulls, issued by the agent's operator.
 *
 * A lender may pull an agent's credit report only with a single-use consent token bound to that agent, that lender and a
 * purpose. On the bureau, issuing one is an operator action (admin key), so until this existed a lender could not pull a
 * report without FORGE issuing consent by hand. Here the workspace that owns an agent authorises a named institution
 * itself, and hands the token to the lender.
 *
 * Rules enforced here, not left to the caller:
 *  - only an agent the workspace owns (the bureau's `managedBy`), checked before any token is issued;
 *  - the purpose is one of the four the bureau knows, and the lifetime is bounded (default one hour, at most a day);
 *  - the token is shown to the caller once and never stored: only who authorised what is recorded;
 *  - a workspace can list and revoke only its own authorisations.
 */

import { query, queryOne } from './db';
import { bureauAgentVisibleTo, getBureauConsentStates, issueBureauConsent, revokeBureauConsent, type IssuedConsent } from './forge-services';

export const CONSENT_PURPOSES = ['credit_application', 'account_review', 'employment', 'insurance'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const DEFAULT_TTL_SECONDS = 3600;
export const MAX_TTL_SECONDS = 86_400;

export interface IssueInput { agentId: string; requestorId: string; purpose: ConsentPurpose; ttlSeconds: number }

export function validateIssueInput(raw: unknown): { ok: true; value: IssueInput } | { ok: false; message: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const agentId = typeof r.agentId === 'string' ? r.agentId.trim() : '';
  const requestorId = typeof r.requestorId === 'string' ? r.requestorId.trim() : '';
  if (!agentId) return { ok: false, message: 'agentId is required' };
  if (!requestorId) return { ok: false, message: 'requestorId (the lender\'s institution id) is required' };
  if (requestorId.length > 200 || agentId.length > 200) return { ok: false, message: 'agentId and requestorId must be at most 200 characters' };
  const purpose = r.purpose;
  if (typeof purpose !== 'string' || !(CONSENT_PURPOSES as readonly string[]).includes(purpose)) {
    return { ok: false, message: `purpose must be one of ${CONSENT_PURPOSES.join(', ')}` };
  }
  let ttl = DEFAULT_TTL_SECONDS;
  if (r.ttlSeconds !== undefined) {
    if (typeof r.ttlSeconds !== 'number' || !Number.isInteger(r.ttlSeconds) || r.ttlSeconds < 60 || r.ttlSeconds > MAX_TTL_SECONDS) {
      return { ok: false, message: `ttlSeconds must be a whole number between 60 and ${MAX_TTL_SECONDS}` };
    }
    ttl = r.ttlSeconds;
  }
  return { ok: true, value: { agentId, requestorId, purpose: purpose as ConsentPurpose, ttlSeconds: ttl } };
}

export interface ConsentRow {
  jti: string; tenant_id: string; agent_id: string; requestor_id: string; purpose: string;
  issued_by: string; issued_at: string; expires_at: string; revoked_at: string | null;
}

/** `used`: a lender has already pulled a report with it. `active`: not expired, not revoked, and not known to be used. */
export type ConsentStatus = 'active' | 'used' | 'expired' | 'revoked';
export function consentStatus(row: Pick<ConsentRow, 'expires_at' | 'revoked_at'>, now = Date.now()): ConsentStatus {
  if (row.revoked_at) return 'revoked';
  return Date.parse(row.expires_at) <= now ? 'expired' : 'active';
}

export type IssueOutcome =
  | { ok: true; consent: IssuedConsent }
  | { ok: false; status: number; error: string; message: string };

export async function issueConsentForWorkspace(tenantId: string, issuedBy: string, input: IssueInput): Promise<IssueOutcome> {
  // 404, not 403: do not confirm that another workspace's agent exists.
  if (!(await bureauAgentVisibleTo(tenantId, input.agentId))) {
    return { ok: false, status: 404, error: 'NotFound', message: 'No such agent in this workspace.' };
  }
  const issued = await issueBureauConsent(input);
  if (issued.ok === false) {
    return { ok: false, status: 502, error: 'BureauUnavailable', message: 'The bureau could not issue consent. Try again shortly.' };
  }
  await query(
    `INSERT INTO bureau_consents (jti, tenant_id, agent_id, requestor_id, purpose, issued_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [issued.data.jti, tenantId, input.agentId, input.requestorId, input.purpose, issuedBy, issued.data.expiresAt],
  );
  return { ok: true, consent: issued.data };
}

export async function listConsents(tenantId: string, limit = 100): Promise<Array<ConsentRow & { status: ConsentStatus }>> {
  const rows = await query<ConsentRow>(
    `SELECT jti, tenant_id, agent_id, requestor_id, purpose, issued_by, issued_at, expires_at, revoked_at
       FROM bureau_consents WHERE tenant_id = $1 ORDER BY issued_at DESC LIMIT $2`,
    [tenantId, limit],
  );
  const now = Date.now();
  const base = rows.map((r) => ({ ...r, status: consentStatus(r, now) }));
  // Ask the bureau which still-open ones a lender has already used. If it cannot say, leave them as they are.
  const open = base.filter((r) => r.status === 'active').map((r) => r.jti);
  const states = await getBureauConsentStates(open);
  return base.map((r) => (r.status === 'active' && states[r.jti] === 'spent' ? { ...r, status: 'used' as const } : r));
}

export type RevokeOutcome =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string };

export async function revokeConsentForWorkspace(tenantId: string, jti: string): Promise<RevokeOutcome> {
  const row = await queryOne<ConsentRow>(
    `SELECT jti, tenant_id, agent_id, requestor_id, purpose, issued_by, issued_at, expires_at, revoked_at
       FROM bureau_consents WHERE jti = $1 AND tenant_id = $2`,
    [jti, tenantId],
  );
  if (!row) return { ok: false, status: 404, error: 'NotFound', message: 'No such consent in this workspace.' };
  if (row.revoked_at) return { ok: false, status: 409, error: 'AlreadyRevoked', message: 'That consent is already revoked.' };
  if (consentStatus(row) === 'expired') return { ok: false, status: 409, error: 'Expired', message: 'That consent has already expired.' };

  // Tell the bureau first. If it cannot be reached we must not record the consent as withdrawn while it is still usable.
  const exp = Math.floor(Date.parse(row.expires_at) / 1000);
  const res = await revokeBureauConsent(jti, exp);
  if (!res.ok) return { ok: false, status: 502, error: 'BureauUnavailable', message: 'The bureau could not revoke this consent. It is still valid; try again.' };
  await query(`UPDATE bureau_consents SET revoked_at = NOW() WHERE jti = $1 AND tenant_id = $2`, [jti, tenantId]);
  return { ok: true };
}

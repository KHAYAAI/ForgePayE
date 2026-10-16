/**
 * Giving the bureau a signed statement of an agent's record at FORGE custody, and taking it back.
 *
 * Custody signs a short statement (counts only) naming the key the agent pays from. The operator, here, hands it to the bureau, which
 * checks the signature and that the key is the agent's own wallet, then uses two figures from it in the agent's Mode 2 score.
 * Submitting it IS the consent, so it is never done silently: an explicit acknowledgement is required, and who submitted it is recorded.
 *
 * Rules enforced here, not left to the caller:
 *  - only an agent the workspace owns (the bureau's `managedBy`), checked before the bureau is asked anything;
 *  - an explicit acknowledgement, every time;
 *  - the acting user's email is what the bureau records as the submitter; the caller cannot choose another;
 *  - a workspace can view and withdraw only its own agents' statements;
 *  - the bureau's reasons for refusing a statement are passed on in plain words.
 */

import { bureauAdminCall, bureauAgentVisibleTo } from './forge-services';

export const MAX_STATEMENT_CHARS = 20_000;

export interface SubmitInput { agentId: string; payload: string; signature: string; acknowledged: true; consentRef?: string }

/** What we say the operator is agreeing to. Provisional wording: counsel has not yet reviewed it (docs/launch/12-popia-custody-attestations.md). */
export const ACKNOWLEDGEMENT =
  'I am authorised to share this signed statement about my agent with the FORGE credit bureau. The bureau will use it to calculate my agent\'s ' +
  'score, which lenders I authorise may see. I can withdraw it at any time and the bureau will erase it.';

export function validateSubmitInput(raw: unknown): { ok: true; value: SubmitInput } | { ok: false; message: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const agentId = typeof r.agentId === 'string' ? r.agentId.trim() : '';
  if (!agentId || agentId.length > 200) return { ok: false, message: 'agentId is required' };
  if (r.acknowledged !== true) return { ok: false, message: 'You must tick the acknowledgement to share the statement. Nothing was sent.' };

  // The statement is what custody issued: { payload, signature }, pasted as JSON text or sent as an object. A response from custody
  // also carries an informational publicKey, which is ignored: the bureau only trusts the keys it was configured with.
  let env: unknown = r.statement;
  if (typeof env === 'string') {
    if (env.length > MAX_STATEMENT_CHARS) return { ok: false, message: 'That statement is too large to be one from custody.' };
    try { env = JSON.parse(env); } catch { return { ok: false, message: 'That is not valid JSON. Paste the statement exactly as custody gave it.' }; }
  }
  const e = env as { payload?: unknown; signature?: unknown } | null;
  if (!e || typeof e.payload !== 'string' || typeof e.signature !== 'string' || !e.payload || !e.signature) {
    return { ok: false, message: 'The statement must contain "payload" and "signature", both text, as custody issued them.' };
  }
  if (e.payload.length > MAX_STATEMENT_CHARS) return { ok: false, message: 'That statement is too large to be one from custody.' };

  const ref = r.consentRef;
  if (ref !== undefined && (typeof ref !== 'string' || ref.length > 200)) return { ok: false, message: 'consentRef must be at most 200 characters' };
  return { ok: true, value: { agentId, payload: e.payload, signature: e.signature, acknowledged: true, ...(typeof ref === 'string' && ref ? { consentRef: ref } : {}) } };
}

/** The bureau's refusal codes, in words an operator can act on. */
const REASONS: Record<string, string> = {
  unconfigured: 'Custody statements are not switched on yet. Ask FORGE to enable them.',
  bad_signature: 'The signature does not check out against the custody key the bureau trusts. Paste the statement exactly as custody gave it; do not edit it.',
  invalid_payload: 'The statement is signed but is not in the expected form.',
  expired: 'This statement has expired. Ask your custody administrator for a fresh one.',
  not_yet_valid: 'This statement is dated in the future. Check the clock on the custody system.',
  validity_too_long: 'This statement is valid for longer than the bureau accepts (14 days). Ask for one with a shorter validity.',
  agent_has_no_evm_address: 'This agent has no proven wallet, so a custody record cannot be matched to it. Connect its wallet first.',
  wallet_mismatch: 'The custody key in this statement is not this agent\'s wallet. A statement can only be used for the agent that pays from that key.',
  subject_mismatch: 'This statement was issued for a different agent.',
  not_newer: 'The bureau already holds this statement or a newer one.',
  record_went_backwards: 'This statement shows lower lifetime totals than the one the bureau holds, which cannot happen to a real record, so it was not accepted.',
  different_custody_agent: 'This agent is already linked to a different custody agent. Withdraw the existing statement first if that is intended.',
};

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string; message: string };

export interface AttestationSummary {
  agentId: string; custodyAgentId: string; keyAddress: string; agentStatus: string;
  issuedAt: string; expiresAt: string; expired: boolean; expiresInDays: number; renewalDue: boolean; erasedAfter: string;
  receivedAt: string; submittedBy: string;
  record: { transfers: number; released: number; refused: number; refusalsByReason: Record<string, number> };
  signals: { successRateBps: number | null; budgetComplianceRate: number | null; attempts: number } | null;
}

const notFound = (): Outcome<never> => ({ ok: false, status: 404, error: 'NotFound', message: 'No such agent in this workspace.' });

export async function submitStatement(tenantId: string, userEmail: string, input: SubmitInput): Promise<Outcome<AttestationSummary>> {
  if (!(await bureauAgentVisibleTo(tenantId, input.agentId))) return notFound();
  const res = await bureauAdminCall<AttestationSummary>('POST', `/v1/agents/${encodeURIComponent(input.agentId)}/custody-attestation`, {
    payload: input.payload, signature: input.signature, submittedBy: userEmail, ...(input.consentRef ? { consentRef: input.consentRef } : {}),
  });
  if (res.ok && res.data) return { ok: true, value: res.data };
  const code = (res.error as { error?: string } | null)?.error ?? '';
  if (res.status === 0 || res.status >= 500 && code !== 'unconfigured') {
    return { ok: false, status: 502, error: 'BureauUnavailable', message: 'The bureau could not be reached. Nothing was changed. Try again.' };
  }
  return { ok: false, status: res.status === 503 ? 503 : res.status === 409 ? 409 : 422, error: code || 'Refused', message: REASONS[code] ?? 'The bureau did not accept that statement.' };
}

export async function getStatement(tenantId: string, agentId: string): Promise<Outcome<AttestationSummary | null>> {
  if (!(await bureauAgentVisibleTo(tenantId, agentId))) return notFound();
  const res = await bureauAdminCall<AttestationSummary>('GET', `/v1/agents/${encodeURIComponent(agentId)}/custody-attestation`);
  if (res.ok && res.data) return { ok: true, value: res.data };
  if (res.status === 404) return { ok: true, value: null };
  return { ok: false, status: 502, error: 'BureauUnavailable', message: 'The bureau could not be reached.' };
}

export async function withdrawStatement(tenantId: string, agentId: string): Promise<Outcome<{ erased: boolean }>> {
  if (!(await bureauAgentVisibleTo(tenantId, agentId))) return notFound();
  const res = await bureauAdminCall('DELETE', `/v1/agents/${encodeURIComponent(agentId)}/custody-attestation`);
  if (res.ok) return { ok: true, value: { erased: true } };
  if (res.status === 404) return { ok: true, value: { erased: false } };       // nothing was held: the end state the operator wanted
  return { ok: false, status: 502, error: 'BureauUnavailable', message: 'The bureau could not be reached. Consent was NOT withdrawn. Try again.' };
}

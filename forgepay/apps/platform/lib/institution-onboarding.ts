/**
 * Onboarding an institution (a lender or furnisher such as a microfinance institution) onto the bureau API.
 *
 *   1. A workspace applies: who it is, where it is registered, what it will use the API for, which access it wants.
 *   2. FORGE's operator workspace reviews and approves (choosing the access and limits) or rejects, with a reason.
 *   3. Approval provisions the institution on the bureau: register, activate, set limits, and retire the registration key (which
 *      nobody has seen), so no credential exists until the institution creates its own.
 *   4. The institution's owners and admins create and revoke their own API keys here; a key is shown once.
 *
 * Provisioning is resumable: the bureau id is saved as soon as it exists and every later step is safe to repeat, so a failure part
 * way through can be retried by approving again rather than leaving a half-made institution behind.
 */

import { randomUUID } from 'node:crypto';
import { query, queryOne } from './db';
import { bureauAdminCall } from './forge-services';
import { isBureauOperator } from './bureau-scope';

export const INSTITUTION_TYPES = ['cefi_lender', 'bank', 'defi_protocol', 'saas_platform'] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];
/** What an institution may ask for. Dispute resolution is the bureau's own power and is never requestable. */
export const REQUESTABLE_SCOPES = ['ingest_events', 'pull_scores', 'read_profile'] as const;
export const DEFAULT_SCOPES = [...REQUESTABLE_SCOPES];

export interface ApplicationInput {
  name: string; institutionType: InstitutionType; country: string; registrationNo?: string;
  contactEmail: string; intendedUse: string; requestedScopes: string[];
}

export function validateApplication(raw: unknown): { ok: true; value: ApplicationInput } | { ok: false; message: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = str(r.name, 200);
  const country = str(r.country, 8).toUpperCase();
  const contactEmail = str(r.contactEmail, 200);
  const intendedUse = str(r.intendedUse, 2000);
  const registrationNo = str(r.registrationNo, 100) || undefined;
  if (name.length < 2) return { ok: false, message: 'name is required' };
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, message: 'country must be a two-letter ISO country code, such as ZA' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) return { ok: false, message: 'contactEmail must be a valid email address' };
  if (intendedUse.length < 20) return { ok: false, message: 'Describe what you will use the API for (at least a sentence).' };
  if (!(INSTITUTION_TYPES as readonly string[]).includes(r.institutionType as string)) {
    return { ok: false, message: `institutionType must be one of ${INSTITUTION_TYPES.join(', ')}` };
  }
  const scopesRaw = r.requestedScopes === undefined ? DEFAULT_SCOPES : r.requestedScopes;
  if (!Array.isArray(scopesRaw) || scopesRaw.length === 0 || !scopesRaw.every((s) => (REQUESTABLE_SCOPES as readonly string[]).includes(s as string))) {
    return { ok: false, message: `requestedScopes must be a non-empty list from: ${REQUESTABLE_SCOPES.join(', ')}` };
  }
  return {
    ok: true,
    value: { name, institutionType: r.institutionType as InstitutionType, country, registrationNo, contactEmail, intendedUse, requestedScopes: [...new Set(scopesRaw as string[])] },
  };
}

export interface ApplicationRow {
  id: string; tenant_id: string; name: string; institution_type: string; country: string; registration_no: string | null;
  contact_email: string; intended_use: string; requested_scopes: string[]; status: 'pending' | 'provisioning' | 'approved' | 'rejected';
  contributor_id: string | null; granted_scopes: string[] | null; decided_by: string | null; decided_at: string | null;
  decision_reason: string | null; created_at: string;
}

const COLUMNS = `id, tenant_id, name, institution_type, country, registration_no, contact_email, intended_use, requested_scopes, status,
  contributor_id, granted_scopes, decided_by, decided_at, decision_reason, created_at`;

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): { ok: false; status: number; error: string; message: string } => ({ ok: false, status, error, message });

export async function apply(tenantId: string, input: ApplicationInput): Promise<Outcome<ApplicationRow>> {
  const live = await queryOne<{ id: string }>(
    `SELECT id FROM institution_applications WHERE tenant_id = $1 AND status IN ('pending','provisioning','approved')`, [tenantId],
  );
  if (live) return fail(409, 'AlreadyApplied', 'This workspace already has an application or an approved institution.');
  const id = `app_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  try {
    await query(
      `INSERT INTO institution_applications (id, tenant_id, name, institution_type, country, registration_no, contact_email, intended_use, requested_scopes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, tenantId, input.name, input.institutionType, input.country, input.registrationNo ?? null, input.contactEmail, input.intendedUse, input.requestedScopes],
    );
  } catch {
    return fail(409, 'AlreadyApplied', 'This workspace already has an application or an approved institution.'); // lost a race against the unique index
  }
  const row = await queryOne<ApplicationRow>(`SELECT ${COLUMNS} FROM institution_applications WHERE id = $1`, [id]);
  return { ok: true, value: row! };
}

export async function currentApplication(tenantId: string): Promise<ApplicationRow | null> {
  return queryOne<ApplicationRow>(`SELECT ${COLUMNS} FROM institution_applications WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`, [tenantId]);
}

export async function getApplication(id: string): Promise<ApplicationRow | null> {
  return queryOne<ApplicationRow>(`SELECT ${COLUMNS} FROM institution_applications WHERE id = $1`, [id]);
}

export async function listApplications(status?: string): Promise<ApplicationRow[]> {
  return status
    ? query<ApplicationRow>(`SELECT ${COLUMNS} FROM institution_applications WHERE status = $1 ORDER BY created_at`, [status])
    : query<ApplicationRow>(`SELECT ${COLUMNS} FROM institution_applications ORDER BY created_at DESC LIMIT 200`);
}

export interface Decision {
  approve: boolean; reason?: string; scopes?: string[]; requestsPerMinute?: number | null; maxPullsPerDay?: number | null;
}

export function validateDecision(raw: unknown, requested: string[]): Outcome<Decision> {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.approve !== 'boolean') return fail(400, 'ValidationError', 'approve must be true or false');
  const reason = typeof r.reason === 'string' ? r.reason.trim().slice(0, 1000) : undefined;
  if (!r.approve) {
    if (!reason) return fail(400, 'ValidationError', 'Give a reason when rejecting.');
    return { ok: true, value: { approve: false, reason } };
  }
  let scopes = requested;
  if (r.scopes !== undefined) {
    if (!Array.isArray(r.scopes) || r.scopes.length === 0 || !r.scopes.every((s) => (REQUESTABLE_SCOPES as readonly string[]).includes(s as string))) {
      return fail(400, 'ValidationError', `scopes must be a non-empty list from: ${REQUESTABLE_SCOPES.join(', ')}`);
    }
    scopes = [...new Set(r.scopes as string[])];
  }
  const num = (v: unknown, min: number, max: number): number | null | undefined | 'bad' => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : 'bad';
  };
  const rpm = num(r.requestsPerMinute, 1, 100_000);
  const pulls = num(r.maxPullsPerDay, 0, 100_000);
  if (rpm === 'bad') return fail(400, 'ValidationError', 'requestsPerMinute must be a whole number from 1 to 100000');
  if (pulls === 'bad') return fail(400, 'ValidationError', 'maxPullsPerDay must be a whole number from 0 to 100000');
  return { ok: true, value: { approve: true, reason, scopes, requestsPerMinute: rpm, maxPullsPerDay: pulls } };
}

/** Approve (provisioning the institution on the bureau) or reject. Only the operator workspace may call this. */
export async function decide(operatorTenantId: string, decidedBy: string, applicationId: string, decision: Decision): Promise<Outcome<ApplicationRow>> {
  if (!isBureauOperator(operatorTenantId)) return fail(403, 'Forbidden', 'Only the operator workspace decides applications.');
  const app = await queryOne<ApplicationRow>(`SELECT ${COLUMNS} FROM institution_applications WHERE id = $1`, [applicationId]);
  if (!app) return fail(404, 'NotFound', 'No such application.');
  if (app.status === 'approved' || app.status === 'rejected') return fail(409, 'AlreadyDecided', `That application is already ${app.status}.`);

  if (!decision.approve) {
    if (app.status === 'provisioning') return fail(409, 'Provisioning', 'Provisioning has started; finish approving it (retry the approval) rather than rejecting.');
    await query(
      `UPDATE institution_applications SET status = 'rejected', decided_by = $2, decided_at = NOW(), decision_reason = $3 WHERE id = $1 AND status = 'pending'`,
      [applicationId, decidedBy, decision.reason],
    );
    return { ok: true, value: (await queryOne<ApplicationRow>(`SELECT ${COLUMNS} FROM institution_applications WHERE id = $1`, [applicationId]))! };
  }

  const scopes = decision.scopes ?? app.requested_scopes;
  let contributorId = app.contributor_id;

  // 1. Register on the bureau, once. The id is saved straight away so a retry resumes instead of registering a second one.
  if (!contributorId) {
    const reg = await bureauAdminCall<{ id: string }>('POST', '/v1/contributors', { name: app.name, type: app.institution_type, permissions: scopes });
    if (!reg.ok || !reg.data?.id) return fail(502, 'BureauUnavailable', 'The bureau could not register the institution. Nothing was changed; try again.');
    contributorId = reg.data.id;
    await query(
      `UPDATE institution_applications SET status = 'provisioning', contributor_id = $2, granted_scopes = $3 WHERE id = $1`,
      [applicationId, contributorId, scopes],
    );
  }

  const stuck = (step: string) => fail(502, 'ProvisioningIncomplete', `The institution is registered but "${step}" did not complete. Approve again to finish; nothing was lost.`);

  // 2. Activate, 3. limits, 4. retire the registration key. Each is safe to repeat.
  const active = await bureauAdminCall('PUT', `/v1/contributors/${contributorId}/status`, { status: 'active', reason: `approved by ${decidedBy}` });
  if (!active.ok) return stuck('activate');
  const limits: Record<string, number | null> = {};
  if (decision.requestsPerMinute !== undefined) limits.requestsPerMinute = decision.requestsPerMinute;
  if (decision.maxPullsPerDay !== undefined) limits.maxPullsPerDay = decision.maxPullsPerDay;
  if (Object.keys(limits).length) {
    const lim = await bureauAdminCall('PUT', `/v1/contributors/${contributorId}/limits`, limits);
    if (!lim.ok) return stuck('limits');
  }
  const retired = await bureauAdminCall('DELETE', `/v1/contributors/${contributorId}/keys/primary`);
  if (!retired.ok && retired.status !== 409) return stuck('retire the registration key'); // 409: already revoked on an earlier attempt

  await query(
    `UPDATE institution_applications SET status = 'approved', decided_by = $2, decided_at = NOW(), decision_reason = $3 WHERE id = $1`,
    [applicationId, decidedBy, decision.reason ?? null],
  );
  return { ok: true, value: (await queryOne<ApplicationRow>(`SELECT ${COLUMNS} FROM institution_applications WHERE id = $1`, [applicationId]))! };
}

// ── Keys, for an approved institution ─────────────────────────────────────────

async function approvedContributor(tenantId: string): Promise<string | null> {
  const row = await queryOne<{ contributor_id: string }>(
    `SELECT contributor_id FROM institution_applications WHERE tenant_id = $1 AND status = 'approved' AND contributor_id IS NOT NULL`, [tenantId],
  );
  return row?.contributor_id ?? null;
}

interface KeyView { id: string; label?: string; status: 'active' | 'revoked' | 'expired'; createdAt: string; expiresAt?: string; lastUsedAt?: string }

export async function listKeys(tenantId: string): Promise<Outcome<{ institutionId: string; keys: KeyView[] }>> {
  const id = await approvedContributor(tenantId);
  if (!id) return fail(404, 'NotFound', 'This workspace has no approved institution.');
  const res = await bureauAdminCall<{ keys: KeyView[] }>('GET', `/v1/contributors/${id}/keys`);
  if (!res.ok || !res.data) return fail(502, 'BureauUnavailable', 'Could not read the keys from the bureau.');
  return { ok: true, value: { institutionId: id, keys: res.data.keys } };
}

export async function issueKey(tenantId: string, body: { label?: unknown; expiresInDays?: unknown }): Promise<Outcome<{ institutionId: string; apiKey: string; key: KeyView }>> {
  const id = await approvedContributor(tenantId);
  if (!id) return fail(404, 'NotFound', 'This workspace has no approved institution.');
  const payload: { label?: string; expiresInDays?: number } = {};
  if (typeof body.label === 'string' && body.label.trim()) payload.label = body.label.trim().slice(0, 80);
  if (body.expiresInDays !== undefined) {
    if (typeof body.expiresInDays !== 'number' || !Number.isInteger(body.expiresInDays) || body.expiresInDays < 1 || body.expiresInDays > 730) {
      return fail(400, 'ValidationError', 'expiresInDays must be a whole number from 1 to 730');
    }
    payload.expiresInDays = body.expiresInDays;
  }
  const res = await bureauAdminCall<{ apiKey: string; key: KeyView }>('POST', `/v1/contributors/${id}/keys`, payload);
  if (res.status === 409) return fail(409, 'TooManyKeys', 'You already have the maximum number of active keys. Revoke one first.');
  if (!res.ok || !res.data) return fail(502, 'BureauUnavailable', 'The bureau could not issue a key.');
  return { ok: true, value: { institutionId: id, apiKey: res.data.apiKey, key: res.data.key } };
}

export async function revokeKey(tenantId: string, keyId: string): Promise<Outcome<{ revoked: string }>> {
  const listed = await listKeys(tenantId);
  if (listed.ok === false) return listed;
  const key = listed.value.keys.find((k) => k.id === keyId);
  if (!key) return fail(404, 'NotFound', 'No such key.');
  if (key.status !== 'active') return fail(409, 'NotActive', 'That key is already revoked or expired.');
  // The same rule an institution has on the bureau itself: never revoke the last working key, or the institution locks itself out.
  if (listed.value.keys.filter((k) => k.status === 'active').length <= 1) {
    return fail(409, 'LastKey', 'This is your only active key. Create a new key first, then revoke this one.');
  }
  const res = await bureauAdminCall('DELETE', `/v1/contributors/${listed.value.institutionId}/keys/${encodeURIComponent(keyId)}`);
  if (!res.ok) return fail(502, 'BureauUnavailable', 'The bureau could not revoke that key. It is still valid.');
  return { ok: true, value: { revoked: keyId } };
}


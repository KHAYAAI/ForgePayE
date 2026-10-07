import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('./forge-services', () => ({
  bureauAgentVisibleTo: vi.fn(),
  getBureauConsentStates: vi.fn(),
  issueBureauConsent: vi.fn(),
  revokeBureauConsent: vi.fn(),
}));

import { query, queryOne } from './db';
import { bureauAgentVisibleTo, getBureauConsentStates, issueBureauConsent, revokeBureauConsent } from './forge-services';
import {
  consentStatus, DEFAULT_TTL_SECONDS, issueConsentForWorkspace, listConsents, MAX_TTL_SECONDS,
  revokeConsentForWorkspace, validateIssueInput,
} from './bureau-consent';
import { can } from './rbac';

const q = vi.mocked(query);
const qo = vi.mocked(queryOne);
const visible = vi.mocked(bureauAgentVisibleTo);
const issue = vi.mocked(issueBureauConsent);
const revoke = vi.mocked(revokeBureauConsent);
const states = vi.mocked(getBureauConsentStates);

beforeEach(() => { vi.resetAllMocks(); });

const good = { agentId: 'agent_1', requestorId: 'lender_1', purpose: 'credit_application' };

describe('validateIssueInput', () => {
  it('accepts a complete request and defaults the lifetime to an hour', () => {
    const r = validateIssueInput(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ttlSeconds).toBe(DEFAULT_TTL_SECONDS);
  });
  it('rejects missing fields and unknown purposes', () => {
    expect(validateIssueInput({ ...good, agentId: '' }).ok).toBe(false);
    expect(validateIssueInput({ ...good, requestorId: '  ' }).ok).toBe(false);
    expect(validateIssueInput({ ...good, purpose: 'marketing' }).ok).toBe(false);
    expect(validateIssueInput(null).ok).toBe(false);
  });
  it('bounds the lifetime: at least a minute, at most a day, whole seconds', () => {
    expect(validateIssueInput({ ...good, ttlSeconds: 59 }).ok).toBe(false);
    expect(validateIssueInput({ ...good, ttlSeconds: MAX_TTL_SECONDS + 1 }).ok).toBe(false);
    expect(validateIssueInput({ ...good, ttlSeconds: 90.5 }).ok).toBe(false);
    expect(validateIssueInput({ ...good, ttlSeconds: '3600' }).ok).toBe(false);
    expect(validateIssueInput({ ...good, ttlSeconds: MAX_TTL_SECONDS }).ok).toBe(true);
  });
});

describe('consentStatus', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  it('is revoked, expired or active', () => {
    expect(consentStatus({ expires_at: '2026-10-07T13:00:00Z', revoked_at: null }, now)).toBe('active');
    expect(consentStatus({ expires_at: '2026-10-07T11:00:00Z', revoked_at: null }, now)).toBe('expired');
    expect(consentStatus({ expires_at: '2026-10-07T13:00:00Z', revoked_at: '2026-10-07T11:30:00Z' }, now)).toBe('revoked');
  });
});

describe('issuing consent for a workspace', () => {
  const input = { agentId: 'agent_1', requestorId: 'lender_1', purpose: 'credit_application' as const, ttlSeconds: 3600 };
  const token = { consentToken: 'SECRET.TOKEN.VALUE', jti: 'jti-1', expiresAt: '2026-10-07T13:00:00Z', scope: { agentId: 'agent_1', requestorId: 'lender_1', purpose: 'credit_application' } };

  it('refuses an agent the workspace does not own, with 404, before the bureau is asked for anything', async () => {
    visible.mockResolvedValue(false);
    const r = await issueConsentForWorkspace('ws_a', 'a@x.test', input);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.status).toBe(404);
    expect(issue).not.toHaveBeenCalled();
    expect(q).not.toHaveBeenCalled();
    expect(visible).toHaveBeenCalledWith('ws_a', 'agent_1');
  });

  it('issues, records who authorised what, and never stores the token', async () => {
    visible.mockResolvedValue(true);
    issue.mockResolvedValue({ ok: true, data: token });
    q.mockResolvedValue([]);
    const r = await issueConsentForWorkspace('ws_a', 'a@x.test', input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.consent.consentToken).toBe('SECRET.TOKEN.VALUE'); // returned to the caller once
    expect(q).toHaveBeenCalledTimes(1);
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toMatch(/INSERT INTO bureau_consents/);
    expect(params).toEqual(['jti-1', 'ws_a', 'agent_1', 'lender_1', 'credit_application', 'a@x.test', '2026-10-07T13:00:00Z']);
    expect(JSON.stringify(q.mock.calls)).not.toContain('SECRET.TOKEN.VALUE');
  });

  it('records nothing when the bureau cannot issue', async () => {
    visible.mockResolvedValue(true);
    issue.mockResolvedValue({ ok: false, status: 0, error: 'down' });
    const r = await issueConsentForWorkspace('ws_a', 'a@x.test', input);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.status).toBe(502);
    expect(q).not.toHaveBeenCalled();
  });
});

describe('listing and revoking', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    jti: 'jti-1', tenant_id: 'ws_a', agent_id: 'agent_1', requestor_id: 'lender_1', purpose: 'credit_application', issued_by: 'a@x.test',
    issued_at: '2026-10-07T12:00:00Z', expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked_at: null, ...over,
  });

  it('lists only the workspace\'s own rows, with a status', async () => {
    q.mockResolvedValue([row(), row({ jti: 'jti-2', revoked_at: '2026-10-07T12:10:00Z' })]);
    states.mockResolvedValue({});
    const rows = await listConsents('ws_a');
    expect(q.mock.calls[0]![1]![0]).toBe('ws_a');
    expect(rows.map((r) => r.status)).toEqual(['active', 'revoked']);
  });

  it('shows a token the lender has already used as used, and leaves it open when the bureau cannot say', async () => {
    q.mockResolvedValue([row(), row({ jti: 'jti-2' })]);
    states.mockResolvedValue({ 'jti-1': 'spent', 'jti-2': 'unused' });
    expect((await listConsents('ws_a')).map((r) => r.status)).toEqual(['used', 'active']);
    states.mockResolvedValue({});
    expect((await listConsents('ws_a')).map((r) => r.status)).toEqual(['active', 'active']);
    // only still-open ones are asked about
    q.mockResolvedValue([row({ revoked_at: '2026-10-07T12:10:00Z' }), row({ jti: 'jti-9', expires_at: '2020-01-01T00:00:00Z' })]);
    states.mockClear();
    await listConsents('ws_a');
    expect(states).toHaveBeenCalledWith([]);
  });

  it('cannot revoke another workspace\'s consent (the lookup is by workspace too)', async () => {
    qo.mockResolvedValue(null);
    const r = await revokeConsentForWorkspace('ws_b', 'jti-1');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.status).toBe(404);
    expect(qo.mock.calls[0]![1]).toEqual(['jti-1', 'ws_b']);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('tells the bureau first, then marks it revoked', async () => {
    qo.mockResolvedValue(row());
    revoke.mockResolvedValue({ ok: true, status: 200 });
    q.mockResolvedValue([]);
    const r = await revokeConsentForWorkspace('ws_a', 'jti-1');
    expect(r.ok).toBe(true);
    expect(revoke).toHaveBeenCalledWith('jti-1', expect.any(Number));
    expect(q.mock.calls[0]![0]).toMatch(/UPDATE bureau_consents SET revoked_at/);
  });

  it('does not mark it revoked when the bureau could not be told (it is still usable)', async () => {
    qo.mockResolvedValue(row());
    revoke.mockResolvedValue({ ok: false, status: 0 });
    const r = await revokeConsentForWorkspace('ws_a', 'jti-1');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.status).toBe(502);
    expect(q).not.toHaveBeenCalled();
  });

  it('reports an already revoked or expired consent instead of repeating it', async () => {
    qo.mockResolvedValue(row({ revoked_at: '2026-10-07T12:10:00Z' }));
    const again = await revokeConsentForWorkspace('ws_a', 'jti-1');
    if (again.ok === false) expect(again.error).toBe('AlreadyRevoked');
    qo.mockResolvedValue(row({ expires_at: '2020-01-01T00:00:00Z' }));
    const expired = await revokeConsentForWorkspace('ws_a', 'jti-1');
    if (expired.ok === false) expect(expired.error).toBe('Expired');
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe('who may authorise a lender', () => {
  it('owners and admins; not approvers or analysts', () => {
    expect(can('owner', 'manage:consent')).toBe(true);
    expect(can('admin', 'manage:consent')).toBe(true);
    expect(can('approver', 'manage:consent')).toBe(false);
    expect(can('analyst', 'manage:consent')).toBe(false);
    expect(can(undefined, 'manage:consent')).toBe(false);
  });
});

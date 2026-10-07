import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const apps = new Map<string, Row>();
let failNextInsert = false;

// A small stand-in for the statements the module runs.
vi.mock('./db', () => ({
  query: vi.fn(async (sql: string, p: unknown[] = []) => {
    if (/INSERT INTO institution_applications/.test(sql)) {
      if (failNextInsert) { failNextInsert = false; throw new Error('unique violation'); }
      const [id, tenant_id, name, institution_type, country, registration_no, contact_email, intended_use, requested_scopes] = p as any[];
      apps.set(id, { id, tenant_id, name, institution_type, country, registration_no, contact_email, intended_use, requested_scopes, status: 'pending', contributor_id: null, granted_scopes: null, decided_by: null, decided_at: null, decision_reason: null, created_at: new Date().toISOString() });
      return [];
    }
    if (/SET status = 'rejected'/.test(sql)) { const a = apps.get(p[0] as string)!; if (a.status === 'pending') Object.assign(a, { status: 'rejected', decided_by: p[1], decision_reason: p[2] }); return []; }
    if (/SET status = 'provisioning'/.test(sql)) { Object.assign(apps.get(p[0] as string)!, { status: 'provisioning', contributor_id: p[1], granted_scopes: p[2] }); return []; }
    if (/SET status = 'approved'/.test(sql)) { Object.assign(apps.get(p[0] as string)!, { status: 'approved', decided_by: p[1], decision_reason: p[2] }); return []; }
    if (/FROM institution_applications WHERE status = \$1/.test(sql)) return [...apps.values()].filter((a) => a.status === p[0]);
    if (/FROM institution_applications ORDER BY/.test(sql)) return [...apps.values()];
    return [];
  }),
  queryOne: vi.fn(async (sql: string, p: unknown[] = []) => {
    if (/SELECT id FROM institution_applications WHERE tenant_id/.test(sql)) return [...apps.values()].find((a) => a.tenant_id === p[0] && ['pending', 'provisioning', 'approved'].includes(a.status)) ?? null;
    if (/SELECT contributor_id FROM institution_applications/.test(sql)) { const a = [...apps.values()].find((x) => x.tenant_id === p[0] && x.status === 'approved' && x.contributor_id); return a ? { contributor_id: a.contributor_id } : null; }
    if (/WHERE tenant_id = \$1 ORDER BY created_at DESC/.test(sql)) return [...apps.values()].filter((a) => a.tenant_id === p[0]).pop() ?? null;
    if (/FROM institution_applications WHERE id = \$1/.test(sql)) return apps.get(p[0] as string) ?? null;
    return null;
  }),
}));

const calls: Array<{ method: string; path: string; body?: unknown }> = [];
let script: (method: string, path: string, body?: unknown) => { ok: boolean; status: number; data: any } = () => ({ ok: true, status: 200, data: {} });
vi.mock('./forge-services', () => ({
  bureauAdminCall: vi.fn(async (method: string, path: string, body?: unknown) => { calls.push({ method, path, body }); return script(method, path, body); }),
}));

import { apply, currentApplication, decide, issueKey, listKeys, revokeKey, validateApplication, validateDecision } from './institution-onboarding';

const VALID = { name: 'Acme Microfinance', institutionType: 'cefi_lender', country: 'za', contactEmail: 'ops@acme.test', intendedUse: 'We lend working capital to agents and will report repayments.', requestedScopes: ['ingest_events', 'pull_scores'] };

beforeEach(() => {
  apps.clear(); calls.length = 0; failNextInsert = false;
  process.env['FORGE_OPERATOR_TENANT_ID'] = 'ws_operator';
  script = (_m, path) => (path === '/v1/contributors' ? { ok: true, status: 201, data: { id: 'contrib_1' } } : { ok: true, status: 200, data: {} });
});

async function pendingApp(tenant = 'ws_a') {
  const v = validateApplication(VALID); if (!v.ok) throw new Error('invalid fixture');
  const r = await apply(tenant, v.value); if (!r.ok) throw new Error('apply failed');
  return r.value;
}

describe('validateApplication', () => {
  it('accepts a complete application and normalises the country', () => {
    const v = validateApplication(VALID);
    expect(v.ok && v.value.country).toBe('ZA');
  });
  it('defaults the requested access, and refuses scopes it does not grant (dispute resolution is the bureau\'s own)', () => {
    const { requestedScopes: _omit, ...rest } = VALID;
    const d = validateApplication(rest);
    expect(d.ok && d.value.requestedScopes).toEqual(['ingest_events', 'pull_scores', 'read_profile']);
    expect(validateApplication({ ...VALID, requestedScopes: ['manage_disputes'] }).ok).toBe(false);
    expect(validateApplication({ ...VALID, requestedScopes: ['admin'] }).ok).toBe(false);
    expect(validateApplication({ ...VALID, requestedScopes: [] }).ok).toBe(false);
  });
  it('rejects missing or malformed fields and unknown types', () => {
    for (const bad of [{ ...VALID, name: '' }, { ...VALID, country: 'ZAF' }, { ...VALID, country: '1a' }, { ...VALID, contactEmail: 'nope' },
      { ...VALID, intendedUse: 'short' }, { ...VALID, institutionType: 'forgepay_internal' }, { ...VALID, institutionType: 'x' }, null]) {
      expect(validateApplication(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('applying', () => {
  it('records a pending application for the workspace', async () => {
    const a = await pendingApp();
    expect(a).toMatchObject({ status: 'pending', tenant_id: 'ws_a', country: 'ZA' });
    expect((await currentApplication('ws_a'))?.id).toBe(a.id);
    expect(await currentApplication('ws_other')).toBeNull();
  });
  it('allows one live application per workspace, and a lost race is reported the same way', async () => {
    await pendingApp();
    const v = validateApplication(VALID); if (!v.ok) throw new Error();
    expect(await apply('ws_a', v.value)).toMatchObject({ ok: false, status: 409, error: 'AlreadyApplied' });
    failNextInsert = true;
    expect(await apply('ws_b', v.value)).toMatchObject({ ok: false, status: 409 });
  });
  it('lets a workspace apply again after a rejection', async () => {
    const a = await pendingApp();
    await decide('ws_operator', 'op@forge.test', a.id, { approve: false, reason: 'Incomplete details' });
    const v = validateApplication(VALID); if (!v.ok) throw new Error();
    expect((await apply('ws_a', v.value)).ok).toBe(true);
  });
});

describe('validateDecision', () => {
  it('needs a reason to reject, accepts limits, and refuses bad ones', () => {
    expect(validateDecision({ approve: false }, ['ingest_events']).ok).toBe(false);
    expect(validateDecision({ approve: false, reason: 'No' }, ['ingest_events']).ok).toBe(true);
    const ok = validateDecision({ approve: true, requestsPerMinute: 120, maxPullsPerDay: 50 }, ['ingest_events']);
    expect(ok.ok && ok.value).toMatchObject({ approve: true, scopes: ['ingest_events'], requestsPerMinute: 120, maxPullsPerDay: 50 });
    for (const bad of [{ approve: true, requestsPerMinute: 0 }, { approve: true, maxPullsPerDay: -1 }, { approve: true, scopes: ['admin'] }, { approve: 'yes' }, { approve: true, requestsPerMinute: 1.5 }]) {
      expect(validateDecision(bad, ['ingest_events']).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('deciding', () => {
  it('only the operator workspace may decide', async () => {
    const a = await pendingApp();
    expect(await decide('ws_a', 'x@y.test', a.id, { approve: true })).toMatchObject({ ok: false, status: 403 });
    expect(calls).toHaveLength(0);
    process.env['FORGE_OPERATOR_TENANT_ID'] = '';
    expect(await decide('', 'x@y.test', a.id, { approve: true })).toMatchObject({ ok: false, status: 403 });
  });

  it('approval registers, activates, applies limits, then retires the registration key, in that order', async () => {
    const a = await pendingApp();
    const r = await decide('ws_operator', 'op@forge.test', a.id, { approve: true, scopes: ['pull_scores'], requestsPerMinute: 120, maxPullsPerDay: null });
    expect(r.ok && r.value).toMatchObject({ status: 'approved', contributor_id: 'contrib_1', granted_scopes: ['pull_scores'], decided_by: 'op@forge.test' });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /v1/contributors', 'PUT /v1/contributors/contrib_1/status', 'PUT /v1/contributors/contrib_1/limits', 'DELETE /v1/contributors/contrib_1/keys/primary',
    ]);
    expect(calls[0]!.body).toMatchObject({ name: 'Acme Microfinance', type: 'cefi_lender', permissions: ['pull_scores'] });
    expect(calls[2]!.body).toEqual({ requestsPerMinute: 120, maxPullsPerDay: null });
  });

  it('skips the limits call when none were chosen', async () => {
    const a = await pendingApp();
    await decide('ws_operator', 'op@forge.test', a.id, { approve: true });
    expect(calls.some((c) => c.path.endsWith('/limits'))).toBe(false);
  });

  it('if the bureau cannot register, nothing changes and the application stays pending', async () => {
    script = () => ({ ok: false, status: 502, data: null });
    const a = await pendingApp();
    const r = await decide('ws_operator', 'op@forge.test', a.id, { approve: true });
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(apps.get(a.id)!.status).toBe('pending');
  });

  it('a failure part way is resumable: the bureau id is kept and a retry does not register a second institution', async () => {
    let activateFails = true;
    script = (_m, path) => {
      if (path === '/v1/contributors') return { ok: true, status: 201, data: { id: 'contrib_1' } };
      if (path.endsWith('/status') && activateFails) return { ok: false, status: 500, data: null };
      return { ok: true, status: 200, data: {} };
    };
    const a = await pendingApp();
    const first = await decide('ws_operator', 'op@forge.test', a.id, { approve: true });
    expect(first).toMatchObject({ ok: false, error: 'ProvisioningIncomplete' });
    expect(apps.get(a.id)).toMatchObject({ status: 'provisioning', contributor_id: 'contrib_1' });
    activateFails = false; calls.length = 0;
    const second = await decide('ws_operator', 'op@forge.test', a.id, { approve: true });
    expect(second.ok && second.value.status).toBe('approved');
    expect(calls.filter((c) => c.path === '/v1/contributors')).toHaveLength(0);          // not registered again
  });

  it('treats "registration key already retired" as done, and cannot reject once provisioning has begun', async () => {
    script = (m, path) => (path === '/v1/contributors' ? { ok: true, status: 201, data: { id: 'c9' } } : m === 'DELETE' ? { ok: false, status: 409, data: null } : { ok: true, status: 200, data: {} });
    const a = await pendingApp();
    expect((await decide('ws_operator', 'op', a.id, { approve: true })).ok).toBe(true);
    const b = await pendingApp('ws_b');
    Object.assign(apps.get(b.id)!, { status: 'provisioning', contributor_id: 'c10' });
    expect(await decide('ws_operator', 'op', b.id, { approve: false, reason: 'no' })).toMatchObject({ ok: false, status: 409, error: 'Provisioning' });
  });

  it('cannot decide the same application twice', async () => {
    const a = await pendingApp();
    await decide('ws_operator', 'op', a.id, { approve: true });
    expect(await decide('ws_operator', 'op', a.id, { approve: false, reason: 'x' })).toMatchObject({ ok: false, status: 409, error: 'AlreadyDecided' });
    expect(await decide('ws_operator', 'op', 'app_missing', { approve: true })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('keys', () => {
  async function approved(tenant = 'ws_a') {
    const a = await pendingApp(tenant);
    await decide('ws_operator', 'op', a.id, { approve: true });
    calls.length = 0;
    return a;
  }
  const key = (id: string, status: 'active' | 'revoked' = 'active') => ({ id, status, createdAt: '2026-10-07T00:00:00Z' });

  it('a workspace with no approved institution has no keys, and cannot create any', async () => {
    await pendingApp();
    expect(await listKeys('ws_a')).toMatchObject({ ok: false, status: 404 });
    expect(await issueKey('ws_a', {})).toMatchObject({ ok: false, status: 404 });
    expect(await revokeKey('ws_a', 'k1')).toMatchObject({ ok: false, status: 404 });
    expect(calls).toHaveLength(0);
  });

  it('acts only on the workspace\'s own institution', async () => {
    await approved('ws_a');
    script = (_m, path) => ({ ok: true, status: 200, data: { keys: [key('k1')], apiKey: 'ck_new', key: key('k2') }, ...(path ? {} : {}) });
    await issueKey('ws_a', { label: 'prod' });
    await listKeys('ws_a');
    expect(calls.every((c) => c.path.startsWith('/v1/contributors/contrib_1/keys'))).toBe(true);
    expect(await listKeys('ws_b')).toMatchObject({ ok: false, status: 404 });          // another workspace has none
  });

  it('issues a key (label, expiry validated) and maps the bureau\'s limit to a clear message', async () => {
    await approved();
    script = () => ({ ok: true, status: 201, data: { apiKey: 'ck_shown_once', key: key('k2') } });
    const r = await issueKey('ws_a', { label: '  prod  ', expiresInDays: 30 });
    expect(r.ok && r.value.apiKey).toBe('ck_shown_once');
    expect(calls[0]!.body).toEqual({ label: 'prod', expiresInDays: 30 });
    expect(await issueKey('ws_a', { expiresInDays: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(await issueKey('ws_a', { expiresInDays: 1.5 })).toMatchObject({ ok: false, status: 400 });
    script = () => ({ ok: false, status: 409, data: null });
    expect(await issueKey('ws_a', {})).toMatchObject({ ok: false, status: 409, error: 'TooManyKeys' });
  });

  it('will not revoke the only active key, but revokes another, and not one that is already revoked', async () => {
    await approved();
    script = () => ({ ok: true, status: 200, data: { keys: [key('only')] } });
    expect(await revokeKey('ws_a', 'only')).toMatchObject({ ok: false, status: 409, error: 'LastKey' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    script = (m) => (m === 'GET' ? { ok: true, status: 200, data: { keys: [key('a'), key('b'), key('old', 'revoked')] } } : { ok: true, status: 200, data: {} });
    calls.length = 0;
    expect((await revokeKey('ws_a', 'a')).ok).toBe(true);
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/v1/contributors/contrib_1/keys/a' });
    expect(await revokeKey('ws_a', 'old')).toMatchObject({ ok: false, error: 'NotActive' });
    expect(await revokeKey('ws_a', 'ghost')).toMatchObject({ ok: false, status: 404 });
  });
});

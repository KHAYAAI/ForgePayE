/**
 * The Didit company-register provider. The base fixtures are the real response shapes captured from Didit's sandbox application
 * (search: kyb_registry.companies[] with a short-lived handle; select: kyb_registry with the record). What is tested is mostly what is
 * REFUSED: a sandbox answer in production, a hand-typed company, a guess between several matches, a number with an unrelated name,
 * and any failure being read as a verdict on the company. And that nothing is paid for unless exactly one acceptable company is found.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  DiditConfigError, DiditKybProvider, ENDPOINTS, HEADER, diditConfigFromEnv, installKybProvider, normName, normNumber, sameName,
  type DiditConfig, type FetchLike,
} from './kyb-didit';
import { currentKybProvider, operatorEligibility, setKybProvider, UnconfiguredKybProvider, verifyOperator } from './kyb';
import type { AgentCreditProfile } from './types';

// A made-up placeholder, deliberately word-like so it is not mistaken for a real credential by secret scanners.
const FAKE_VALUE = 'placeholder-for-tests-not-a-real-secret';
const CFG: DiditConfig = { apiKey: FAKE_VALUE, baseUrl: 'https://didit.example.org', timeoutMs: 5000, refuseSandbox: true, dailyMaxSelects: 20, cacheMs: 3_600_000 };

const cand = (over: Record<string, unknown> = {}) => ({
  kyb_response_id: 'kyb-handle-1', name: 'ACME TRADING (PTY) LTD', registration_number: '2019/123456/07', status: 'active',
  type: 'Private Limited Company', risk_level: null, fetch_status: 'pending', ...over,
});
const searchReply = (companies: unknown[], over: Record<string, unknown> = {}) => ({
  request_id: 'r1', kyb_registry: { companies, pagination: { total: companies.length, page: 1, per_page: 25 }, search_status: 'resolved', search_resolved: true, ...over },
  vendor_data: null, metadata: null, created_at: '2026-10-15T13:00:00Z',
});
const selectReply = (over: Record<string, unknown> = {}) => ({
  request_id: 'r2', registry_tier_requested: 'basic', registry_tier_delivered: 'basic',
  kyb_registry: {
    uuid: 'u1', node_id: 'feature_kyb_registry', status: 'Approved', registry_status: 'active', data_resolved: true,
    company_name: 'ACME TRADING (PTY) LTD', registration_number: '2019/123456/07', country_code: 'ZA', region: '', company_type: 'Private Limited Company',
    incorporation_date: '2019-03-01', registered_address: '1 Main Rd', tax_number: null, risk_level: null, verification_status: null,
    is_from_registry: true, fetch_status: 'resolved', officers: [], beneficial_owners: [], addresses: [], registry_data: {},
    registry_ownership_status: 'not_requested', ...over,
  },
});

interface Call { path: string; headers: Record<string, string>; body: any }
function didit(opts: {
  search?: () => { status: number; json?: unknown; raw?: string } | 'throw' | 'timeout';
  select?: () => { status: number; json?: unknown; raw?: string } | 'throw';
} = {}) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, headers: init.headers, body: JSON.parse(init.body) });
    const handler: () => { status: number; json?: unknown; raw?: string } | 'throw' | 'timeout' = path === ENDPOINTS.search ? (opts.search ?? (() => ({ status: 200, json: searchReply([cand()]) })))
      : (opts.select ?? (() => ({ status: 200, json: selectReply() })));
    const r = handler();
    if (r === 'throw') throw new Error('fetch failed');
    if (r === 'timeout') { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
    return { status: r.status, text: async () => r.raw ?? JSON.stringify(r.json ?? {}) };
  };
  const make = (cfg: Partial<DiditConfig> = {}, now: () => number = Date.now) => new DiditKybProvider({ ...CFG, ...cfg }, { fetch, now });
  return { calls, make, selects: () => calls.filter((c) => c.path === ENDPOINTS.select), searches: () => calls.filter((c) => c.path === ENDPOINTS.search) };
}
const Q = { countryCode: 'za', legalName: 'Acme Trading (Pty) Ltd', registrationNumber: '2019/123456/07' };

describe('a company found in the register', () => {
  it('is verified, and the request carries the key only in its header, with the expected fields', async () => {
    const d = didit(); const v = await d.make().lookup(Q);
    expect(v).toMatchObject({ status: 'verified', provider: 'didit', registeredName: 'ACME TRADING (PTY) LTD', registrationNumber: '2019/123456/07', registryStatus: 'active' });
    expect(v.registry).toMatch(/\(ZA\)/);
    expect(d.searches()[0]!.body).toEqual({ country_code: 'ZA', registration_number: '2019/123456/07', name: 'Acme Trading (Pty) Ltd', search_type: 'contains' });
    expect(d.selects()[0]!.body).toEqual({ kyb_response_id: 'kyb-handle-1' });
    for (const c of d.calls) { expect(c.headers[HEADER]).toBe(FAKE_VALUE); expect(JSON.stringify(c.body)).not.toContain(FAKE_VALUE); }
    expect(d.selects()).toHaveLength(1);
  });

  it('compares numbers and names the way registers and operators actually write them', () => {
    expect(normNumber('2019/123456/07')).toBe(normNumber('2019 123456-07'));
    expect(sameName('Acme Trading (Pty) Ltd', 'ACME TRADING PROPRIETARY LIMITED')).toBe(true);
    expect(sameName('Müller & Söhne GmbH', 'Muller and Sohne')).toBe(true);
    expect(sameName('Acme Trading', 'Acme Holdings')).toBe(false);
    expect(sameName('(Pty) Ltd', '(Pty) Ltd')).toBe(false);                 // nothing but legal-form words is not a name
    expect(normName('  The  ACME   Co. ')).toBe('acme');
  });

  it('can be found by name alone when exactly one company matches', async () => {
    const d = didit(); const v = await d.make().lookup({ countryCode: 'ZA', legalName: 'acme trading pty ltd' });
    expect(v.status).toBe('verified');
    expect(d.searches()[0]!.body.registration_number).toBeUndefined();
  });
});

describe('nothing is paid for unless exactly one acceptable company is found', () => {
  it('a number that is not in the results: not found, no select', async () => {
    const d = didit({ search: () => ({ status: 200, json: searchReply([cand({ registration_number: '1999/000001/07' })]) }) });
    const v = await d.make().lookup(Q);
    expect(v).toMatchObject({ status: 'not_found' });
    expect(d.selects()).toHaveLength(0);
  });

  it('a real number that belongs to a company with an unrelated name: not found, and says so', async () => {
    const d = didit({ search: () => ({ status: 200, json: searchReply([cand({ name: 'COMPLETELY DIFFERENT HOLDINGS (PTY) LTD' })]) }) });
    const v = await d.make().lookup(Q);
    expect(v).toMatchObject({ status: 'not_found', registryStatus: expect.stringMatching(/name_mismatch/) });
    expect(d.selects()).toHaveLength(0);
  });

  it('several companies match a name: refuses to guess', async () => {
    const d = didit({ search: () => ({ status: 200, json: searchReply([cand(), cand({ kyb_response_id: 'h2', registration_number: '2020/000002/07' })]) }) });
    const v = await d.make().lookup({ countryCode: 'ZA', legalName: 'Acme Trading' });
    expect(v).toMatchObject({ status: 'not_found', registryStatus: expect.stringMatching(/ambiguous/) });
    expect(d.selects()).toHaveLength(0);
  });

  it('no results, or nothing to search on: not found, no select', async () => {
    const none = didit({ search: () => ({ status: 200, json: searchReply([]) }) });
    expect((await none.make().lookup(Q)).status).toBe('not_found');
    expect(none.selects()).toHaveLength(0);
    const blank = didit();
    expect(await blank.make().lookup({ countryCode: 'ZA' })).toMatchObject({ status: 'not_found' });
    expect(blank.calls).toHaveLength(1);                                          // it searched (free) and found nothing usable
    expect(blank.selects()).toHaveLength(0);
  });

  it('a company the search lists as not active is inactive, without paying to read it', async () => {
    const d = didit({ search: () => ({ status: 200, json: searchReply([cand({ status: 'dissolved' })]) }) });
    const v = await d.make().lookup(Q);
    expect(v).toMatchObject({ status: 'inactive', registryStatus: 'dissolved' });
    expect(d.selects()).toHaveLength(0);
  });
});

describe('the record that comes back', () => {
  it('a status other than active leaves the company unverified, whatever the word', async () => {
    for (const word of ['dissolved', 'liquidation', 'struck off', 'some word we have never seen']) {
      const d = didit({ select: () => ({ status: 200, json: selectReply({ registry_status: word }) }) });
      expect(await d.make().lookup(Q), word).toMatchObject({ status: 'inactive', registryStatus: word });
    }
    const upper = didit({ select: () => ({ status: 200, json: selectReply({ registry_status: 'Active' }) }) });
    expect((await upper.make().lookup(Q)).status).toBe('verified');
  });

  it('refuses a record that did not come from the register (a company typed in by hand)', async () => {
    const d = didit({ select: () => ({ status: 200, json: selectReply({ is_from_registry: false, user_provided_data: { name: 'x' } }) }) });
    expect(await d.make().lookup(Q)).toMatchObject({ status: 'registry_unavailable', registryStatus: expect.stringMatching(/did not come from the register/) });
  });

  it('refuses an unfinished record, a record for another country or number, and a record with missing fields', async () => {
    const cases: Array<Record<string, unknown>> = [
      { data_resolved: false }, { fetch_status: 'pending' }, { country_code: 'GB' }, { registration_number: '2001/000009/07' },
      { company_name: undefined }, { registry_status: undefined },
    ];
    for (const over of cases) {
      const d = didit({ select: () => ({ status: 200, json: selectReply(over) }) });
      expect((await d.make().lookup(Q)).status, JSON.stringify(over)).toBe('registry_unavailable');
    }
  });
});

describe('sandbox answers', () => {
  const sandboxSearch = () => ({ status: 200, json: searchReply([cand({ kyb_response_id: 'sandbox-kyb-response-abc', registration_number: 'SANDBOX-0001' })]) });
  const sandboxSelect = () => ({ status: 200, json: selectReply({ registration_number: 'SANDBOX-0001', registry_data: { sandbox: true } }) });

  it('are refused where sandbox is not allowed, because the sandbox calls every name an active company', async () => {
    const a = didit({ search: sandboxSearch });
    expect(await a.make().lookup({ countryCode: 'ZA', legalName: 'Any Name At All' })).toMatchObject({ status: 'registry_unavailable', registryStatus: expect.stringMatching(/sandbox/) });
    expect(a.selects()).toHaveLength(0);
    const b = didit({ select: sandboxSelect });
    expect((await b.make().lookup(Q)).status).toBe('registry_unavailable');
  });

  it('are refused on the record itself, even for a name-only lookup with no number to contradict them', async () => {
    // The sandbox echoes the name it was given and calls it active. With nothing else to check, only the sandbox marker stops it.
    const d = didit({ select: () => ({ status: 200, json: selectReply({ registration_number: 'SANDBOX-0001', registry_data: { sandbox: true } }) }) });
    expect(await d.make().lookup({ countryCode: 'ZA', legalName: 'Acme Trading (Pty) Ltd' })).toMatchObject({
      status: 'registry_unavailable', registryStatus: expect.stringMatching(/sandbox/),
    });
  });

  it('are accepted only when the environment allows it', async () => {
    const d = didit({ search: () => ({ status: 200, json: searchReply([cand({ kyb_response_id: 'sandbox-x', registration_number: 'SANDBOX-0001', name: 'Dev Co' })]) }),
      select: () => ({ status: 200, json: selectReply({ registration_number: 'SANDBOX-0001', company_name: 'Dev Co', country_code: 'ZA', registry_data: { sandbox: true } }) }) });
    expect((await d.make({ refuseSandbox: false }).lookup({ countryCode: 'ZA', legalName: 'Dev Co' })).status).toBe('verified');
    expect(diditConfigFromEnv({ DIDIT_API_KEY: FAKE_VALUE, NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv)!.refuseSandbox).toBe(true);
    expect(diditConfigFromEnv({ DIDIT_API_KEY: FAKE_VALUE, NODE_ENV: 'production', DIDIT_ALLOW_SANDBOX: 'true' } as unknown as NodeJS.ProcessEnv)!.refuseSandbox).toBe(false);
    expect(diditConfigFromEnv({ DIDIT_API_KEY: FAKE_VALUE, NODE_ENV: 'development' } as unknown as NodeJS.ProcessEnv)!.refuseSandbox).toBe(false);
    expect(diditConfigFromEnv({ DIDIT_API_KEY: FAKE_VALUE, NODE_ENV: 'production', DIDIT_ALLOW_SANDBOX: 'yes' } as unknown as NodeJS.ProcessEnv)!.refuseSandbox).toBe(true);   // exact value only
  });
});

describe('a failure is never a verdict on the company', () => {
  const failures: Array<[string, Parameters<typeof didit>[0], RegExp]> = [
    ['credentials rejected', { search: () => ({ status: 401, json: {} }) }, /rejected our credentials/],
    ['forbidden', { search: () => ({ status: 403, json: {} }) }, /rejected our credentials/],
    ['rate limited', { search: () => ({ status: 429, json: {} }) }, /rate limiting/],
    ['server error', { search: () => ({ status: 502, json: {} }) }, /HTTP 502/],
    ['network error', { search: () => 'throw' }, /could not be reached/],
    ['timeout', { search: () => 'timeout' }, /did not answer in time/],
    ['unreadable answer', { search: () => ({ status: 200, raw: '<html>oops' }) }, /unreadable/],
    ['unexpected shape', { search: () => ({ status: 200, json: { nope: true } }) }, /unexpected form/],
    ['search not finished', { search: () => ({ status: 200, json: searchReply([cand()], { search_resolved: false, search_status: 'pending' }) }) }, /not finished searching/],
    ['malformed candidate', { search: () => ({ status: 200, json: searchReply([{ name: 'x' }]) }) }, /candidate in an unexpected form/],
    ['select fails', { select: () => ({ status: 500, json: {} }) }, /HTTP 500/],
    ['select times out', { select: () => 'throw' }, /could not be reached/],
  ];
  for (const [name, opts, pattern] of failures) {
    it(`${name}: unavailable (retryable), never not_found or verified, and no key in the answer`, async () => {
      const v = await didit(opts).make().lookup(Q);
      expect(v.status).toBe('registry_unavailable');
      expect(v.registryStatus).toMatch(pattern);
      expect(JSON.stringify(v)).not.toContain(FAKE_VALUE);
    });
  }
});

describe('spend control', () => {
  it('a repeated lookup within the cache window pays once, and again after it', async () => {
    let t = 0; const d = didit(); const p = d.make({ cacheMs: 1000 }, () => t);
    await p.lookup(Q); await p.lookup({ ...Q, registrationNumber: '2019 123456 07' });
    expect(d.selects()).toHaveLength(1);
    t = 5000; await p.lookup(Q);
    expect(d.selects()).toHaveLength(2);
  });

  it('two lookups at the same moment share one paid call', async () => {
    const d = didit(); const p = d.make();
    const [a, b] = await Promise.all([p.lookup(Q), p.lookup(Q)]);
    expect(a.status).toBe('verified'); expect(b.status).toBe('verified');
    expect(d.selects()).toHaveLength(1);
  });

  it('stops paying at the daily cap, reports it as unavailable, and recovers after 24 hours', async () => {
    let t = 0;
    // A stand-in that answers for whatever registration number is asked, so each lookup is distinct and nothing is served from cache.
    const calls: string[] = [];
    let asked = '';
    const fetch: FetchLike = async (url, init) => {
      const path = new URL(url).pathname; const body = JSON.parse(init.body); calls.push(path);
      if (path === ENDPOINTS.search) { asked = body.registration_number; return { status: 200, text: async () => JSON.stringify(searchReply([cand({ registration_number: asked })])) }; }
      return { status: 200, text: async () => JSON.stringify(selectReply({ registration_number: asked })) };
    };
    const p = new DiditKybProvider({ ...CFG, dailyMaxSelects: 2, cacheMs: 1 }, { fetch, now: () => t });
    const q = (n: number) => ({ countryCode: 'ZA', registrationNumber: `2019/12345${n}/07` });

    expect((await p.lookup(q(1))).status).toBe('verified');
    t += 10; expect((await p.lookup(q(2))).status).toBe('verified');
    t += 10; expect(p.selectsRemaining()).toBe(0);
    expect(await p.lookup(q(3))).toMatchObject({ status: 'registry_unavailable', registryStatus: expect.stringMatching(/daily limit/) });
    expect(calls.filter((c) => c === ENDPOINTS.select)).toHaveLength(2);          // the third never reached the paid call
    t += 86_400_001; expect((await p.lookup(q(3))).status).toBe('verified');
  });

  it('counts a select whose reply was lost, because it may have been billed', async () => {
    const d = didit({ select: () => 'throw' }); const p = d.make({ dailyMaxSelects: 1 });
    expect((await p.lookup(Q)).status).toBe('registry_unavailable');
    expect(p.selectsRemaining()).toBe(0);
  });
});

describe('configuration and installation', () => {
  const env = (o: Record<string, string | undefined>) => ({ NODE_ENV: 'production', ...o }) as unknown as NodeJS.ProcessEnv;
  afterEach(() => setKybProvider(new UnconfiguredKybProvider()));

  it('is off without a key, and refuses unsafe settings', () => {
    expect(diditConfigFromEnv(env({}))).toBeNull();
    expect(installKybProvider(env({}))).toMatchObject({ installed: false });
    expect(currentKybProvider().name).toBe('unconfigured');
    expect(() => diditConfigFromEnv(env({ DIDIT_API_KEY: FAKE_VALUE, DIDIT_BASE_URL: 'http://didit.example.org' }))).toThrow(/https/);
    expect(() => diditConfigFromEnv(env({ DIDIT_API_KEY: FAKE_VALUE, DIDIT_BASE_URL: 'https://u:p@didit.example.org' }))).toThrow(/credentials/);
    expect(() => diditConfigFromEnv(env({ DIDIT_API_KEY: FAKE_VALUE, DIDIT_KYB_DAILY_MAX_SELECTS: '0' }))).toThrow(DiditConfigError);
    expect(() => diditConfigFromEnv(env({ DIDIT_API_KEY_FILE: '/nonexistent/key' }))).toThrow(/could not be read/);
  });

  it('installs when a key is configured, with its limits, and the key is not in the description', () => {
    const r = installKybProvider(env({ DIDIT_API_KEY: FAKE_VALUE }));
    expect(r).toMatchObject({ installed: true, provider: 'didit' });
    expect(r.note).toMatch(/at most 20 paid lookups/);
    expect(r.note).not.toContain(FAKE_VALUE);
    expect(currentKybProvider().name).toBe('didit');
  });
});

describe('through the existing verification and policy', () => {
  const profile = (over: Partial<AgentCreditProfile> = {}) => ({
    agentId: 'a1', did: 'did:forge:agent_a1', operatorEntityId: 'op1', operatorEntityType: 'llc', operatorCountry: 'ZA',
    operatorLegalName: 'Acme Trading (Pty) Ltd', operatorRegistrationNumber: '2019/123456/07', ...over,
  }) as AgentCreditProfile;
  afterEach(() => { setKybProvider(new UnconfiguredKybProvider()); delete process.env['JURISTIC_OPERATORS_ONLY']; });

  it('a verified operator is allowed when only juristic operators are accepted; an outage is retryable, not a rejection', async () => {
    process.env['JURISTIC_OPERATORS_ONLY'] = 'true';
    setKybProvider(didit().make());
    const out = await verifyOperator(profile());
    expect(out.ok).toBe(true);
    if (out.ok) expect(operatorEligibility(profile({ operatorVerification: out.verification }))).toMatchObject({ allowed: true });

    setKybProvider(didit({ search: () => 'throw' }).make());
    const down = await verifyOperator(profile());
    if (down.ok) expect(operatorEligibility(profile({ operatorVerification: down.verification }))).toMatchObject({ allowed: false, reason: 'registry_unavailable', retryable: true });
  });
});

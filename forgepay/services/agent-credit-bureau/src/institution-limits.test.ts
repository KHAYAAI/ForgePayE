/**
 * Per-institution request limit and daily pull cap: the maths, the operator route, and the behaviour through the real app.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';
import {
  __resetRateWindows, checkPullCap, checkRate, defaultRequestsPerMinute, parseLimits, recordPull,
} from './institution-limits';

const ADMIN = 'dev-bureau-admin-key';
const json = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });
const plain = (key: string) => ({ authorization: `Bearer ${key}` });

beforeEach(() => __resetRateWindows());

describe('request window (unit)', () => {
  it('allows up to the limit in a minute, then refuses with a reset time, then resets', () => {
    const t0 = 1_000_000;
    for (let i = 1; i <= 3; i++) expect(checkRate('inst', { requestsPerMinute: 3 }, t0 + i).remaining).toBe(3 - i);
    const blocked = checkRate('inst', { requestsPerMinute: 3 }, t0 + 10_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.resetInSeconds).toBeGreaterThan(0);
    expect(blocked.resetInSeconds).toBeLessThanOrEqual(60);
    expect(checkRate('inst', { requestsPerMinute: 3 }, t0 + 61_000).allowed).toBe(true);
  });
  it('budgets are per institution', () => {
    checkRate('a', { requestsPerMinute: 1 });
    expect(checkRate('a', { requestsPerMinute: 1 }).allowed).toBe(false);
    expect(checkRate('b', { requestsPerMinute: 1 }).allowed).toBe(true);
  });
  it('defaults to INSTITUTION_RPM, and to 600 when that is unset or nonsense', () => {
    expect(defaultRequestsPerMinute({} as NodeJS.ProcessEnv)).toBe(600);
    expect(defaultRequestsPerMinute({ INSTITUTION_RPM: '50' } as NodeJS.ProcessEnv)).toBe(50);
    expect(defaultRequestsPerMinute({ INSTITUTION_RPM: 'x' } as NodeJS.ProcessEnv)).toBe(600);
  });
});

describe('daily pull cap (unit)', () => {
  const noon = Date.parse('2026-10-07T12:00:00Z');
  it('no cap means no limit', () => {
    expect(checkPullCap({}, noon)).toEqual({ allowed: true, limit: null, used: 0 });
  });
  it('counts per UTC day and rolls over at midnight', () => {
    const c: { limits: { maxPullsPerDay: number }; pullsToday?: { date: string; count: number } } = { limits: { maxPullsPerDay: 2 } };
    recordPull(c, noon); recordPull(c, noon);
    expect(checkPullCap(c, noon).allowed).toBe(false);
    expect(checkPullCap(c, Date.parse('2026-10-07T23:59:59Z')).allowed).toBe(false);
    expect(checkPullCap(c, Date.parse('2026-10-08T00:00:00Z'))).toEqual({ allowed: true, limit: 2, used: 0 });
    recordPull(c, Date.parse('2026-10-08T01:00:00Z'));
    expect(c.pullsToday).toEqual({ date: '2026-10-08', count: 1 });
  });
  it('a cap of zero blocks every pull', () => {
    expect(checkPullCap({ limits: { maxPullsPerDay: 0 } }, noon).allowed).toBe(false);
  });
});

describe('parseLimits', () => {
  it('accepts valid values, treats null as clearing, and leaves absent keys alone', () => {
    expect(parseLimits({ requestsPerMinute: 120 })).toEqual({ ok: true, value: { requestsPerMinute: 120 }, clear: [] });
    expect(parseLimits({ maxPullsPerDay: null })).toEqual({ ok: true, value: {}, clear: ['maxPullsPerDay'] });
  });
  it('rejects nonsense', () => {
    for (const bad of [null, 'x', {}, { requestsPerMinute: 0 }, { requestsPerMinute: 1.5 }, { requestsPerMinute: '5' }, { maxPullsPerDay: -1 }, { requestsPerMinute: 1e9 }, { requestsPerMinute: 5, extra: 1 }]) {
      expect(parseLimits(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('through the app', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  async function institution(name: string, permissions = ['pull_scores', 'read_profile']) {
    const reg = await app.inject({ method: 'POST', url: '/v1/contributors', headers: json(ADMIN), payload: { name, type: 'cefi_lender', permissions } });
    const { id, apiKey } = reg.json().data;
    await app.inject({ method: 'PUT', url: `/v1/contributors/${id}/status`, headers: json(ADMIN), payload: { status: 'active', reason: 't' } });
    return { id, key: apiKey as string };
  }
  const setLimits = (id: string, body: object, key = ADMIN) => app.inject({ method: 'PUT', url: `/v1/contributors/${id}/limits`, headers: json(key), payload: body });

  it('only an operator sets limits; an institution cannot raise its own', async () => {
    const inst = await institution('Limits Own');
    expect((await setLimits(inst.id, { requestsPerMinute: 99999 }, inst.key)).statusCode).toBe(403);
    expect((await setLimits(inst.id, { requestsPerMinute: 5 })).statusCode).toBe(200);
    expect((await setLimits('nope', { requestsPerMinute: 5 })).statusCode).toBe(404);
    expect((await setLimits(inst.id, { requestsPerMinute: 0 })).statusCode).toBe(400);
  });

  it('shows the budget in headers, then refuses with 429 and Retry-After once it is spent', async () => {
    const inst = await institution('Limits Headers');
    await setLimits(inst.id, { requestsPerMinute: 3 });
    __resetRateWindows();
    const calls = [];
    for (let i = 0; i < 4; i++) calls.push(await app.inject({ method: 'GET', url: '/v1/plans', headers: plain(inst.key) }));
    // /v1/plans is public and not counted; use an authenticated route
    const authed = [];
    for (let i = 0; i < 4; i++) authed.push(await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/keys`, headers: plain(inst.key) }));
    expect(authed.map((r) => r.statusCode)).toEqual([200, 200, 200, 429]);
    expect(authed[0]!.headers['x-ratelimit-limit']).toBe('3');
    expect(authed[0]!.headers['x-ratelimit-remaining']).toBe('2');
    expect(authed[3]!.headers['retry-after']).toBeDefined();
    expect(authed[3]!.json().error).toBe('Too Many Requests');
  });

  it('one institution spending its budget does not touch another\'s, or the operator\'s', async () => {
    const a = await institution('Limits A'); const b = await institution('Limits B');
    await setLimits(a.id, { requestsPerMinute: 1 }); __resetRateWindows();
    await app.inject({ method: 'GET', url: `/v1/contributors/${a.id}/keys`, headers: plain(a.key) });
    expect((await app.inject({ method: 'GET', url: `/v1/contributors/${a.id}/keys`, headers: plain(a.key) })).statusCode).toBe(429);
    expect((await app.inject({ method: 'GET', url: `/v1/contributors/${b.id}/keys`, headers: plain(b.key) })).statusCode).toBe(200);
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: 'GET', url: `/v1/contributors/${a.id}/keys`, headers: plain(ADMIN) })).statusCode).toBe(200);
  });

  it('a null clears a limit and returns to the default', async () => {
    const inst = await institution('Limits Clear');
    await setLimits(inst.id, { requestsPerMinute: 1 });
    const cleared = await setLimits(inst.id, { requestsPerMinute: null });
    expect(cleared.json().data.limits).toEqual({});
    __resetRateWindows();
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/keys`, headers: plain(inst.key) })).statusCode).toBe(200);
  });

  it('the daily pull cap refuses the pull before charging, leaves no inquiry, and the institution sees its limits', async () => {
    const inst = await institution('Cap Lender');
    await app.inject({ method: 'POST', url: `/v1/billing/${inst.id}/credit`, headers: json(ADMIN), payload: { amountUsd: 20, reason: 'test float' } });
    await setLimits(inst.id, { maxPullsPerDay: 1 });
    const agentId = 'agent_prime_001';
    const consent = async () => (await app.inject({ method: 'POST', url: '/v1/consent', headers: json(ADMIN), payload: { agentId, requestorId: inst.id, purpose: 'credit_application' } })).json().data.consentToken as string;
    const pull = (token: string) => app.inject({
      method: 'POST', url: '/v1/lender-reports', headers: json(inst.key),
      payload: { agentId, requestorId: inst.id, requestorName: 'Cap Lender', purpose: 'credit_application', consentToken: token },
    });
    const first = await pull(await consent());
    expect(first.statusCode).toBeLessThan(300);
    const balanceAfterFirst = (await app.inject({ method: 'GET', url: `/v1/billing/${inst.id}/account`, headers: plain(inst.key) })).json().data.balanceUsdCents;
    const t2 = await consent();
    const second = await pull(t2);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: 'DailyPullLimit', limit: 1, used: 1 });
    const balanceAfterSecond = (await app.inject({ method: 'GET', url: `/v1/billing/${inst.id}/account`, headers: plain(inst.key) })).json().data.balanceUsdCents;
    expect(balanceAfterSecond).toBe(balanceAfterFirst);          // nothing was charged
    // the consent was not burned: lift the cap and the same token works
    await setLimits(inst.id, { maxPullsPerDay: 5 });
    expect((await pull(t2)).statusCode).toBeLessThan(300);
    const stats = await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/stats`, headers: plain(ADMIN) });
    expect(stats.json().data.limits).toEqual({ maxPullsPerDay: 5 });
    expect(stats.json().data.pullsToday.count).toBe(2);
  });
});

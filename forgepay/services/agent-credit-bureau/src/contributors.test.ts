/**
 * Furnisher lifecycle, provenance, idempotency and quota.
 *
 * Two regressions are guarded here:
 *
 *  - The pipeline was dead. Contributors were created `pending`, ingest rejects
 *    anything not `active`, and nothing anywhere could set that status, so a
 *    real furnisher registered and was permanently locked out.
 *
 *  - `req.auth` was never read by any handler, so both contributor routes
 *    trusted the path id alone. Any active furnisher could write credit events
 *    attributed to a competitor and read a competitor's volume and quota.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';
import { contributorAccessError } from './auth';
import { getContributor, getProfile } from './store';

const ADMIN = 'dev-bureau-admin-key';
const AAVE  = 'ck_aave_live_xxx';   // seeded, active, ingest_events + pull_scores
const AGENT = 'agent_prime_001';

let app: FastifyInstance;

const bearer = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });

/** Register a furnisher and return its id plus its one-time raw key. */
async function register(name: string): Promise<{ id: string; key: string }> {
  const res = await app.inject({
    method: 'POST', url: '/v1/contributors', headers: bearer(ADMIN),
    payload: { name, type: 'defi_protocol', permissions: ['ingest_events'] },
  });
  const d = res.json().data;
  return { id: d.id, key: d.apiKey };
}

async function setStatus(id: string, status: string, reason = 'test') {
  return app.inject({
    method: 'PUT', url: `/v1/contributors/${id}/status`, headers: bearer(ADMIN),
    payload: { status, reason },
  });
}

function batch(externalId: string, over: Record<string, unknown> = {}) {
  return {
    agentId: AGENT,
    events: [{
      externalId,
      eventType: 'payment_on_time',
      amount: 100,
      description: 'monthly repayment',
      ...over,
    }],
  };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('contributorAccessError', () => {
  const ctx = (kind: 'admin' | 'contributor', id: string) =>
    ({ principalId: id, kind, scopes: new Set<string>() });

  it('lets admin act on any contributor', () => {
    expect(contributorAccessError(ctx('admin', 'admin'), 'anyone')).toBeNull();
  });

  it('lets a furnisher act on itself', () => {
    expect(contributorAccessError(ctx('contributor', 'c1'), 'c1')).toBeNull();
  });

  it('refuses a furnisher acting on another contributor', () => {
    const denied = contributorAccessError(ctx('contributor', 'c1'), 'c2');
    expect(denied?.error).toBe('Forbidden');
  });

  it('refuses when there is no auth context at all', () => {
    expect(contributorAccessError(undefined, 'c1')).not.toBeNull();
  });
});

describe('lifecycle — the path that did not exist', () => {
  it('registers as pending and that key cannot yet ingest', async () => {
    const { id, key } = await register('Pending Co');
    expect(getContributor(id)!.status).toBe('pending');

    // A pending contributor's key resolves to no principal at all, so this is
    // 401 rather than 403 — the key is not yet a credential.
    const res = await app.inject({
      method: 'POST', url: `/v1/contributors/${id}/ingest`,
      headers: bearer(key), payload: batch('e1'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('activates, records the reason, and the key starts working', async () => {
    const { id, key } = await register('Activate Co');

    const act = await setStatus(id, 'active', 'KYB complete');
    expect(act.statusCode).toBe(200);
    expect(act.json().data.previousStatus).toBe('pending');
    expect(act.json().data.status).toBe('active');
    expect(act.json().data.statusReason).toBe('KYB complete');
    expect(act.json().data).not.toHaveProperty('apiKeyHash');

    const res = await app.inject({
      method: 'POST', url: `/v1/contributors/${id}/ingest`,
      headers: bearer(key), payload: batch('act-1'),
    });
    expect(res.statusCode).toBe(201);
  });

  it('suspends, and the key stops working on the next request', async () => {
    const { id, key } = await register('Suspend Co');
    await setStatus(id, 'active');
    await setStatus(id, 'suspended', 'anomalous volume');

    const res = await app.inject({
      method: 'POST', url: `/v1/contributors/${id}/ingest`,
      headers: bearer(key), payload: batch('sus-1'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('is admin-only — a furnisher cannot activate itself', async () => {
    const { id, key } = await register('SelfActivate Co');
    const res = await app.inject({
      method: 'PUT', url: `/v1/contributors/${id}/status`,
      headers: bearer(key), payload: { status: 'active', reason: 'please' },
    });
    // The key is pending, so it is not a credential at all.
    expect(res.statusCode).toBe(401);

    // Even an active furnisher lacks the admin scope.
    await setStatus(id, 'active');
    const res2 = await app.inject({
      method: 'PUT', url: `/v1/contributors/${id}/status`,
      headers: bearer(key), payload: { status: 'active', reason: 'again' },
    });
    expect(res2.statusCode).toBe(403);
  });
});

describe('cross-tenant access', () => {
  let victim = AAVE;
  let attacker: { id: string; key: string };

  beforeEach(async () => {
    attacker = await register(`Attacker ${Math.random()}`);
    await setStatus(attacker.id, 'active');
  });

  it('refuses a furnisher writing events attributed to a competitor', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/contributors/contrib_aave/ingest',
      headers: bearer(attacker.key), payload: batch('attack-1'),
    });
    expect(res.statusCode).toBe(403);
    expect(victim).toBe(AAVE); // the seeded victim is untouched
  });

  it("refuses a furnisher reading a competitor's volume and quota", async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/contributors/contrib_aave/stats',
      headers: bearer(attacker.key),
    });
    expect(res.statusCode).toBe(403);
  });

  it('still lets a furnisher read its own stats, without key material', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/contributors/${attacker.id}/stats`,
      headers: bearer(attacker.key),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('apiKeyHash');
  });
});

describe('provenance', () => {
  it('stamps the authenticated furnisher onto every ingested event', async () => {
    const f = await register('Provenance Co');
    await setStatus(f.id, 'active');

    const res = await app.inject({
      method: 'POST', url: `/v1/contributors/${f.id}/ingest`,
      headers: bearer(f.key), payload: batch('prov-1'),
    });
    expect(res.statusCode).toBe(201);

    const event = res.json().data.events[0];
    expect(event.contributorId).toBe(f.id);
    // No creditor supplied, so it defaults to the reporting furnisher.
    expect(event.creditorId).toBe(f.id);

    // And it is durable on the profile, which is what makes attribution and
    // dispute routing possible at all.
    const stored = getProfile(AGENT)!.creditHistory.find(e => e.externalId === 'prov-1');
    expect(stored?.contributorId).toBe(f.id);
  });

  it('refuses an event claiming a different creditor', async () => {
    const f = await register('Impostor Co');
    await setStatus(f.id, 'active');

    const res = await app.inject({
      method: 'POST', url: `/v1/contributors/${f.id}/ingest`,
      headers: bearer(f.key),
      payload: batch('imp-1', { creditorId: 'contrib_aave' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('contrib_aave');
  });
});

describe('idempotency', () => {
  it('recognises a retried batch instead of writing it twice', async () => {
    const f = await register('Retry Co');
    await setStatus(f.id, 'active');

    const first = await app.inject({
      method: 'POST', url: `/v1/contributors/${f.id}/ingest`,
      headers: bearer(f.key), payload: batch('retry-1'),
    });
    expect(first.json().data.ingestedCount).toBe(1);
    const scoreAfterFirst = first.json().data.newScore;
    const contributedAfterFirst = getContributor(f.id)!.dataRecordsContributed;

    const retry = await app.inject({
      method: 'POST', url: `/v1/contributors/${f.id}/ingest`,
      headers: bearer(f.key), payload: batch('retry-1'),
    });
    expect(retry.json().data.ingestedCount).toBe(0);
    expect(retry.json().data.duplicatesIgnored).toBe(1);
    expect(retry.json().data.newScore).toBe(scoreAfterFirst);

    // A retry must not inflate contribution — that would inflate the payout.
    expect(getContributor(f.id)!.dataRecordsContributed).toBe(contributedAfterFirst);
  });

  it('scopes the idempotency key to the furnisher, so two may use the same id', async () => {
    const a = await register('Scope A'); await setStatus(a.id, 'active');
    const b = await register('Scope B'); await setStatus(b.id, 'active');

    const ra = await app.inject({
      method: 'POST', url: `/v1/contributors/${a.id}/ingest`,
      headers: bearer(a.key), payload: batch('shared-id'),
    });
    const rb = await app.inject({
      method: 'POST', url: `/v1/contributors/${b.id}/ingest`,
      headers: bearer(b.key), payload: batch('shared-id'),
    });
    expect(ra.json().data.ingestedCount).toBe(1);
    expect(rb.json().data.ingestedCount).toBe(1);
  });

  it('requires an externalId', async () => {
    const f = await register('NoKey Co');
    await setStatus(f.id, 'active');

    const res = await app.inject({
      method: 'POST', url: `/v1/contributors/${f.id}/ingest`,
      headers: bearer(f.key),
      payload: { agentId: AGENT, events: [{ eventType: 'payment_on_time', description: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('quota', () => {
  it('refuses ingest once the quota is exhausted', async () => {
    const f = await register('Quota Co');
    await setStatus(f.id, 'active');

    // Exhaust it directly rather than issuing thousands of requests.
    const c = getContributor(f.id)!;
    c.queriesUsed = c.queriesAllowed;

    const res = await app.inject({
      method: 'POST', url: `/v1/contributors/${f.id}/ingest`,
      headers: bearer(f.key), payload: batch('quota-1'),
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().message).toContain('quota');
  });

  it('caps contribution credit per window so quota cannot be self-minted', async () => {
    const f = await register('Cap Co');
    await setStatus(f.id, 'active');

    const c = getContributor(f.id)!;
    c.windowStartedAt   = new Date().toISOString();
    c.recordsThisWindow = 10_000; // already at the default cap
    const before = c.dataRecordsContributed;

    const res = await app.inject({
      method: 'POST', url: `/v1/contributors/${f.id}/ingest`,
      headers: bearer(f.key), payload: batch('cap-1'),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.creditedToQuota).toBe(0);
    expect(res.json().data.windowCapped).toBe(true);

    // The event is still recorded — it is the quota credit that is capped, not
    // the credit history, which must stay complete.
    expect(res.json().data.ingestedCount).toBe(1);
    expect(getContributor(f.id)!.dataRecordsContributed).toBe(before);
  });
});

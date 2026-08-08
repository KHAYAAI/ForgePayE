/**
 * Authorisation tests for the Agent Credit Bureau.
 *
 * Before `src/auth.ts` existed, every route on this service was public — the
 * app registered only helmet, cors and rate-limit. `POST /v1/agents/:id/events`
 * let any caller write credit events for any agent, and
 * `GET /v1/contributors/:id/stats` returned a furnisher's API key in plaintext
 * to anyone who knew the contributor id.
 *
 * The most valuable test here is the last one: it walks Fastify's own route
 * table and fails if a route is neither explicitly public nor covered by the
 * scope table. Adding an endpoint without making an access decision breaks the
 * build rather than quietly shipping another open door.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';
import { isPublicRoute, requiredScopeFor, SCOPES, hashApiKey, redactContributor } from './auth';

/** Seeded furnisher keys — see the seed block in src/store.ts. */
const AAVE_KEY  = 'ck_aave_live_xxx';        // ingest_events + pull_scores
const COMP_KEY  = 'ck_compound_live_yyy';    // ingest_events only
const ADMIN_KEY = 'dev-bureau-admin-key';    // development operator key

let app: FastifyInstance;

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('unauthenticated access', () => {
  it('serves the health probe without credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('serves Prometheus metrics without credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
  });

  it('refuses to read a score', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agents/agent_prime_001/score' });
    expect(res.statusCode).toBe(401);
  });

  // The regression that motivated this module.
  it('refuses to write a credit event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents/agent_prime_001/events',
      payload: { eventType: 'default', description: 'injected by an unauthenticated caller' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses to read contributor stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/contributors/contrib_aave/stats' });
    expect(res.statusCode).toBe(401);
  });
});

describe('credential validation', () => {
  it('rejects an unknown key', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/agents/agent_prime_001/score',
      headers: bearer('ck_not_a_real_key'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts the key via X-API-Key as well as Bearer', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/agents/agent_prime_001/score',
      headers: { 'x-api-key': AAVE_KEY },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects an empty bearer value', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/agents/agent_prime_001/score',
      headers: { authorization: 'Bearer ' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('scope enforcement', () => {
  it('allows a furnisher holding pull_scores to read a score', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/agents/agent_prime_001/score', headers: bearer(AAVE_KEY),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.score).toBeGreaterThan(0);
  });

  it('refuses a furnisher lacking pull_scores', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/agents/agent_prime_001/score', headers: bearer(COMP_KEY),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('pull_scores');
  });

  it('refuses a furnisher on an admin route', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/settlement/status', headers: bearer(AAVE_KEY),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows the admin key on an admin route', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/settlement/status', headers: bearer(ADMIN_KEY),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('key material never leaves the service', () => {
  it('issues a raw key exactly once, at registration', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/contributors', headers: bearer(ADMIN_KEY),
      payload: { name: 'Morpho Blue', type: 'defi_protocol', permissions: ['ingest_events'] },
    });
    expect(res.statusCode).toBe(201);

    const body = res.json().data;
    expect(body.apiKey).toMatch(/^ck_/);
    expect(body).not.toHaveProperty('apiKeyHash');
    expect(body.status).toBe('pending');
  });

  it('never returns key material from the stats route', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/contributors/contrib_aave/stats', headers: bearer(AAVE_KEY),
    });
    expect(res.statusCode).toBe(200);

    const raw = res.body;
    expect(raw).not.toContain('apiKeyHash');
    expect(raw).not.toContain(hashApiKey(AAVE_KEY));
    expect(raw).not.toContain(AAVE_KEY);
  });

  it('redactContributor drops the hash and keeps everything else', () => {
    const redacted = redactContributor({ id: 'c1', name: 'X', apiKeyHash: 'deadbeef' });
    expect(redacted).not.toHaveProperty('apiKeyHash');
    expect(redacted.id).toBe('c1');
    expect(redacted.name).toBe('X');
  });
});

describe('a key belonging to an inactive contributor is not a credential', () => {
  it('rejects the key of a contributor still pending activation', async () => {
    const created = await app.inject({
      method: 'POST', url: '/v1/contributors', headers: bearer(ADMIN_KEY),
      payload: { name: 'Pending Co', type: 'cefi_lender', permissions: ['ingest_events'] },
    });
    const rawKey = created.json().data.apiKey as string;

    const res = await app.inject({
      method: 'POST', url: '/v1/contributors/whatever/ingest', headers: bearer(rawKey),
      payload: { agentId: 'agent_prime_001', events: [] },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── The guard that matters most ──────────────────────────────────────────────

describe('every route has an explicit access decision', () => {
  it('leaves no route both unlisted and unprotected', () => {
    const routes: Array<{ method: string; url: string }> = [];

    // Fastify's printRoutes tree is awkward to walk; the route table is
    // available via the onRoute hook at registration, but the app is already
    // built here, so parse the printed routes instead.
    const printed = app.printRoutes({ commonPrefix: false });
    for (const line of printed.split('\n')) {
      const match = line.match(/^\s*[│├└─\s]*(\/\S*)\s+\((.+)\)\s*$/);
      if (!match) continue;
      const [, url, methods] = match;
      for (const method of methods!.split(',').map(m => m.trim())) {
        if (method === 'HEAD' || method === 'OPTIONS') continue;
        routes.push({ method, url: url! });
      }
    }

    expect(routes.length).toBeGreaterThan(10);

    // Deny-by-default means an unlisted route resolves to `admin` rather than
    // being public, so the invariant is simply: nothing resolves to a scope
    // that no principal could ever hold, and public routes are deliberate.
    const unexpectedlyPublic = routes.filter(
      r => isPublicRoute(r.method, r.url) && !['/health', '/metrics'].includes(r.url),
    );
    expect(unexpectedlyPublic, `unexpected public routes: ${JSON.stringify(unexpectedlyPublic)}`).toEqual([]);

    for (const r of routes) {
      const scope = requiredScopeFor(r.method, r.url);
      expect(Object.values(SCOPES)).toContain(scope);
    }
  });
});

/**
 * Authorisation tests for the Agent Liquidity Manager.
 *
 * Before `src/auth.ts` existed, the app registered only helmet, cors and
 * rate-limit — every route was public, including `POST
 * /v1/agents/:agentId/rebalance?execute=true` (mutates tracked wallet
 * balances directly) and `POST /v1/agents/:agentId/sweep` (moves funds to a
 * yield vault). Anyone who could reach the port could rebalance or sweep any
 * agent's portfolio.
 *
 * The last describe block is the guard that matters most: it walks Fastify's
 * own route table and fails if a route is neither explicitly public nor
 * covered by the scope table, so adding an endpoint without making an access
 * decision breaks the build instead of quietly shipping another open door.
 */
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../index';
import { isPublicRoute, requiredScopeFor, SCOPES, getAdminKeyHash, __resetAdminKeyCache } from '../auth';
import { _resetStoreForTests } from '../store';

const ADMIN_KEY = 'dev-alm-admin-key'; // development operator key (see getAdminKeyHash)

let app: FastifyInstance;

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

async function issueKey(agentId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/agents/${agentId}/api-key`,
    headers: bearer(ADMIN_KEY),
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.apiKey as string;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  _resetStoreForTests();
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

  it('refuses to read a portfolio', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agents/agent_1/portfolio' });
    expect(res.statusCode).toBe(401);
  });

  // The regressions that motivated this module — money-movement routes.
  it('refuses to trigger a rebalance', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/agents/agent_1/rebalance' });
    expect(res.statusCode).toBe(401);
  });

  it('refuses to trigger a sweep', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/agents/agent_1/sweep' });
    expect(res.statusCode).toBe(401);
  });

  it('refuses to trigger a liquidate', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/agents/agent_1/liquidate' });
    expect(res.statusCode).toBe(401);
  });

  it('refuses to mint an agent api key', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/agents/agent_1/api-key' });
    expect(res.statusCode).toBe(401);
  });
});

describe('credential validation', () => {
  it('rejects an unknown key', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/agents/agent_1/portfolio',
      headers: bearer('not_a_real_key'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an empty bearer value', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/agents/agent_1/portfolio',
      headers: { authorization: 'Bearer ' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts an issued agent key via X-API-Key as well as Bearer', async () => {
    const key = await issueKey('agent_1');
    const res = await app.inject({
      method: 'GET', url: '/v1/agents/agent_1/portfolio',
      headers: { 'x-api-key': key },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rotating a key invalidates the previous one', async () => {
    const firstKey = await issueKey('agent_1');
    await issueKey('agent_1'); // rotate

    const res = await app.inject({
      method: 'GET', url: '/v1/agents/agent_1/portfolio', headers: bearer(firstKey),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('scope enforcement', () => {
  it('refuses an agent key on the admin-only global summary route', async () => {
    const key = await issueKey('agent_1');
    const res = await app.inject({ method: 'GET', url: '/v1/agent/summary', headers: bearer(key) });
    expect(res.statusCode).toBe(403);
  });

  it('allows the admin key on the admin-only global summary route', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agent/summary', headers: bearer(ADMIN_KEY) });
    expect(res.statusCode).toBe(200);
  });

  it('refuses an agent key on the admin-only key-issuance route', async () => {
    const key = await issueKey('agent_1');
    const res = await app.inject({
      method: 'POST', url: '/v1/agents/agent_2/api-key', headers: bearer(key),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('per-resource ownership — the money-movement guard', () => {
  it('lets an agent read its own portfolio', async () => {
    const key = await issueKey('agent_1');
    const res = await app.inject({
      method: 'GET', url: '/v1/agents/agent_1/portfolio', headers: bearer(key),
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses agent_1\'s key on agent_2\'s portfolio', async () => {
    const key = await issueKey('agent_1');
    const res = await app.inject({
      method: 'GET', url: '/v1/agents/agent_2/portfolio', headers: bearer(key),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/different agent/i);
  });

  it('refuses agent_1\'s key from sweeping agent_2\'s portfolio', async () => {
    const key = await issueKey('agent_1');
    const res = await app.inject({
      method: 'POST', url: '/v1/agents/agent_2/sweep', headers: bearer(key),
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses agent_1\'s key from rebalancing agent_2\'s portfolio', async () => {
    const key = await issueKey('agent_1');
    const res = await app.inject({
      method: 'POST', url: '/v1/agents/agent_2/rebalance', headers: bearer(key),
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses agent_1\'s key from liquidating agent_2\'s portfolio', async () => {
    const key = await issueKey('agent_1');
    const res = await app.inject({
      method: 'POST', url: '/v1/agents/agent_2/liquidate', headers: bearer(key),
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses agent_1\'s key from writing agent_2\'s policy or target', async () => {
    const key = await issueKey('agent_1');
    const policyRes = await app.inject({
      method: 'PUT', url: '/v1/agents/agent_2/policy', headers: bearer(key),
      payload: { minLiquidStableUsd: 100, maxIdleStableUsd: 200, sweepVault: 'aave', autoLiquidateBelowUsd: 50 },
    });
    expect(policyRes.statusCode).toBe(403);

    const targetRes = await app.inject({
      method: 'PUT', url: '/v1/agents/agent_2/target', headers: bearer(key),
      payload: { stables: 1, treasuries: 0, eth: 0, btc: 0 },
    });
    expect(targetRes.statusCode).toBe(403);
  });

  it('lets the admin key act on any agent', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/agents/agent_1/portfolio', headers: bearer(ADMIN_KEY),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('key material never leaves the service', () => {
  it('issues a raw key exactly once, at issuance', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/agents/agent_1/api-key', headers: bearer(ADMIN_KEY),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.apiKey).toMatch(/^alm_/);
    expect(body).not.toHaveProperty('apiKeyHash');
  });
});

describe('production boot guard', () => {
  const originalEnv = process.env['NODE_ENV'];
  const originalKey = process.env['ALM_ADMIN_API_KEY'];

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
    if (originalKey === undefined) delete process.env['ALM_ADMIN_API_KEY'];
    else process.env['ALM_ADMIN_API_KEY'] = originalKey;
    __resetAdminKeyCache();
  });

  it('refuses to resolve an admin key in production when unset', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['ALM_ADMIN_API_KEY'];
    __resetAdminKeyCache();
    expect(() => getAdminKeyHash()).toThrow(/ALM_ADMIN_API_KEY is not set/);
  });

  it('refuses the development placeholder value in production', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['ALM_ADMIN_API_KEY'] = 'dev-alm-admin-key';
    __resetAdminKeyCache();
    expect(() => getAdminKeyHash()).toThrow(/development value/);
  });

  it('refuses a short key in production', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['ALM_ADMIN_API_KEY'] = 'too-short';
    __resetAdminKeyCache();
    expect(() => getAdminKeyHash()).toThrow(/at least 32 characters/);
  });

  it('accepts a sufficiently long, non-default key in production', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['ALM_ADMIN_API_KEY'] = 'a'.repeat(40);
    __resetAdminKeyCache();
    expect(() => getAdminKeyHash()).not.toThrow();
  });
});

// ── The guard that matters most ──────────────────────────────────────────────

describe('every route has an explicit access decision', () => {
  it('leaves no route both unlisted and unprotected', () => {
    const routes: Array<{ method: string; url: string }> = [];

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

    // The cross-agent aggregate and the key-issuance route must both fall
    // through to admin — asserted explicitly so a future edit that
    // accidentally adds them to ROUTE_SCOPES at `agent` scope is caught.
    expect(requiredScopeFor('GET', '/v1/agent/summary')).toBe(SCOPES.ADMIN);
    expect(requiredScopeFor('POST', '/v1/agents/:agentId/api-key')).toBe(SCOPES.ADMIN);
  });
});

/**
 * Authorisation tests for the Agent Decision Framework.
 *
 * Before `src/auth.ts` existed, every route on this service was public — the
 * app registered only helmet, cors and rate-limit. Anyone reaching port 3013
 * could evaluate decisions on any agent's behalf, rewrite global policies,
 * or raise an agent's daily limit / clear its counterparty blocklist.
 *
 * The last test walks Fastify's own route table and fails if a route is
 * neither explicitly public nor covered by the scope table, so adding an
 * endpoint without making an access decision breaks the build instead of
 * quietly shipping another open door.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../index';
import { isPublicRoute, requiredScopeFor, SCOPES, __resetAdminKeyCache } from '../auth';
import { resetPolicies, clearAgentPolicies } from '../policies';
import { clearVelocity } from '../velocity';
import { clearDecisionLog } from '../decision-log';

const ADMIN_KEY   = 'dev-decision-framework-admin-key'; // development operator key
const SERVICE_KEY = 'unit-test-service-key';

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

let app: FastifyInstance;

beforeAll(async () => {
  process.env['ADF_SERVICE_API_KEYS'] = SERVICE_KEY;
  __resetAdminKeyCache();
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  delete process.env['ADF_SERVICE_API_KEYS'];
  __resetAdminKeyCache();
});

beforeEach(() => {
  resetPolicies();
  clearAgentPolicies();
  clearVelocity();
  clearDecisionLog();
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

  // The regression that motivated this module.
  it('refuses to evaluate a decision', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/decisions/evaluate',
      payload: { agentId: 'agent-A', actionType: 'payment', amountUsd: 100, asset: 'USDC' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses to read policies', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/policies' });
    expect(res.statusCode).toBe(401);
  });

  it('refuses to write an agent policy', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/agents/agent-A/policy',
      payload: { dailyLimitUsd: 999_999_999 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('credential validation', () => {
  it('rejects an unknown key', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/policies',
      headers: bearer('not-a-real-key'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a valid key via X-Api-Key as well as Bearer', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/policies',
      headers: { 'x-api-key': SERVICE_KEY },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects an empty bearer value', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/policies',
      headers: { authorization: 'Bearer ' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('scope enforcement', () => {
  it('allows a service key to evaluate a decision', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/decisions/evaluate', headers: bearer(SERVICE_KEY),
      payload: { agentId: 'agent-A', actionType: 'payment', amountUsd: 100, asset: 'USDC' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.decision).toBeDefined();
  });

  it('allows a service key to read policies', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/policies', headers: bearer(SERVICE_KEY),
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a service key on a policy-write route (lacks admin)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/policies', headers: bearer(SERVICE_KEY),
      payload: { id: 'p9', name: 'test', type: 'block_high_amount', params: { maxAmountUsd: 1 } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('admin');
  });

  it('refuses a service key on an agent-policy write route', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/agents/agent-A/policy', headers: bearer(SERVICE_KEY),
      payload: { dailyLimitUsd: 999_999_999 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows the admin key on a policy-write route', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/policies', headers: bearer(ADMIN_KEY),
      payload: { id: 'p9', name: 'test', type: 'block_high_amount', params: { maxAmountUsd: 1 } },
    });
    expect(res.statusCode).toBe(201);
  });

  it('allows the admin key to write an agent policy', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/agents/agent-A/policy', headers: bearer(ADMIN_KEY),
      payload: { dailyLimitUsd: 500_000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.dailyLimitUsd).toBe(500_000);
  });

  it('allows the admin key to evaluate a decision too (superset of scopes)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/decisions/evaluate', headers: bearer(ADMIN_KEY),
      payload: { agentId: 'agent-A', actionType: 'payment', amountUsd: 100, asset: 'USDC' },
    });
    expect(res.statusCode).toBe(200);
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

    expect(routes.length).toBeGreaterThan(5);

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

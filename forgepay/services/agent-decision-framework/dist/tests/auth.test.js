"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const vitest_1 = require("vitest");
const index_1 = require("../index");
const auth_1 = require("../auth");
const policies_1 = require("../policies");
const velocity_1 = require("../velocity");
const decision_log_1 = require("../decision-log");
const ADMIN_KEY = 'dev-decision-framework-admin-key'; // development operator key
const SERVICE_KEY = 'unit-test-service-key';
const bearer = (key) => ({ authorization: `Bearer ${key}` });
let app;
(0, vitest_1.beforeAll)(async () => {
    process.env['ADF_SERVICE_API_KEYS'] = SERVICE_KEY;
    (0, auth_1.__resetAdminKeyCache)();
    app = await (0, index_1.buildApp)();
    await app.ready();
});
(0, vitest_1.afterAll)(async () => {
    await app.close();
    delete process.env['ADF_SERVICE_API_KEYS'];
    (0, auth_1.__resetAdminKeyCache)();
});
(0, vitest_1.beforeEach)(() => {
    (0, policies_1.resetPolicies)();
    (0, policies_1.clearAgentPolicies)();
    (0, velocity_1.clearVelocity)();
    (0, decision_log_1.clearDecisionLog)();
});
(0, vitest_1.describe)('unauthenticated access', () => {
    (0, vitest_1.it)('serves the health probe without credentials', async () => {
        const res = await app.inject({ method: 'GET', url: '/health' });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
    });
    (0, vitest_1.it)('serves Prometheus metrics without credentials', async () => {
        const res = await app.inject({ method: 'GET', url: '/metrics' });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
    });
    // The regression that motivated this module.
    (0, vitest_1.it)('refuses to evaluate a decision', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/decisions/evaluate',
            payload: { agentId: 'agent-A', actionType: 'payment', amountUsd: 100, asset: 'USDC' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
    (0, vitest_1.it)('refuses to read policies', async () => {
        const res = await app.inject({ method: 'GET', url: '/v1/policies' });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
    (0, vitest_1.it)('refuses to write an agent policy', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/v1/agents/agent-A/policy',
            payload: { dailyLimitUsd: 999_999_999 },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
});
(0, vitest_1.describe)('credential validation', () => {
    (0, vitest_1.it)('rejects an unknown key', async () => {
        const res = await app.inject({
            method: 'GET', url: '/v1/policies',
            headers: bearer('not-a-real-key'),
        });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
    (0, vitest_1.it)('accepts a valid key via X-Api-Key as well as Bearer', async () => {
        const res = await app.inject({
            method: 'GET', url: '/v1/policies',
            headers: { 'x-api-key': SERVICE_KEY },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
    });
    (0, vitest_1.it)('rejects an empty bearer value', async () => {
        const res = await app.inject({
            method: 'GET', url: '/v1/policies',
            headers: { authorization: 'Bearer ' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
});
(0, vitest_1.describe)('scope enforcement', () => {
    (0, vitest_1.it)('allows a service key to evaluate a decision', async () => {
        const res = await app.inject({
            method: 'POST', url: '/v1/decisions/evaluate', headers: bearer(SERVICE_KEY),
            payload: { agentId: 'agent-A', actionType: 'payment', amountUsd: 100, asset: 'USDC' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        (0, vitest_1.expect)(res.json().data.decision).toBeDefined();
    });
    (0, vitest_1.it)('allows a service key to read policies', async () => {
        const res = await app.inject({
            method: 'GET', url: '/v1/policies', headers: bearer(SERVICE_KEY),
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
    });
    (0, vitest_1.it)('refuses a service key on a policy-write route (lacks admin)', async () => {
        const res = await app.inject({
            method: 'POST', url: '/v1/policies', headers: bearer(SERVICE_KEY),
            payload: { id: 'p9', name: 'test', type: 'block_high_amount', params: { maxAmountUsd: 1 } },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(403);
        (0, vitest_1.expect)(res.json().message).toContain('admin');
    });
    (0, vitest_1.it)('refuses a service key on an agent-policy write route', async () => {
        const res = await app.inject({
            method: 'PUT', url: '/v1/agents/agent-A/policy', headers: bearer(SERVICE_KEY),
            payload: { dailyLimitUsd: 999_999_999 },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(403);
    });
    (0, vitest_1.it)('allows the admin key on a policy-write route', async () => {
        const res = await app.inject({
            method: 'POST', url: '/v1/policies', headers: bearer(ADMIN_KEY),
            payload: { id: 'p9', name: 'test', type: 'block_high_amount', params: { maxAmountUsd: 1 } },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(201);
    });
    (0, vitest_1.it)('allows the admin key to write an agent policy', async () => {
        const res = await app.inject({
            method: 'PUT', url: '/v1/agents/agent-A/policy', headers: bearer(ADMIN_KEY),
            payload: { dailyLimitUsd: 500_000 },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        (0, vitest_1.expect)(res.json().data.dailyLimitUsd).toBe(500_000);
    });
    (0, vitest_1.it)('allows the admin key to evaluate a decision too (superset of scopes)', async () => {
        const res = await app.inject({
            method: 'POST', url: '/v1/decisions/evaluate', headers: bearer(ADMIN_KEY),
            payload: { agentId: 'agent-A', actionType: 'payment', amountUsd: 100, asset: 'USDC' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
    });
});
// ── The guard that matters most ──────────────────────────────────────────────
(0, vitest_1.describe)('every route has an explicit access decision', () => {
    (0, vitest_1.it)('leaves no route both unlisted and unprotected', () => {
        const routes = [];
        const printed = app.printRoutes({ commonPrefix: false });
        for (const line of printed.split('\n')) {
            const match = line.match(/^\s*[│├└─\s]*(\/\S*)\s+\((.+)\)\s*$/);
            if (!match)
                continue;
            const [, url, methods] = match;
            for (const method of methods.split(',').map(m => m.trim())) {
                if (method === 'HEAD' || method === 'OPTIONS')
                    continue;
                routes.push({ method, url: url });
            }
        }
        (0, vitest_1.expect)(routes.length).toBeGreaterThan(5);
        const unexpectedlyPublic = routes.filter(r => (0, auth_1.isPublicRoute)(r.method, r.url) && !['/health', '/metrics'].includes(r.url));
        (0, vitest_1.expect)(unexpectedlyPublic, `unexpected public routes: ${JSON.stringify(unexpectedlyPublic)}`).toEqual([]);
        for (const r of routes) {
            const scope = (0, auth_1.requiredScopeFor)(r.method, r.url);
            (0, vitest_1.expect)(Object.values(auth_1.SCOPES)).toContain(scope);
        }
    });
});
//# sourceMappingURL=auth.test.js.map
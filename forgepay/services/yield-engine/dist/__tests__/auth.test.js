"use strict";
/**
 * Auth regression tests for yield-engine.
 *
 * Covers the fix for two bugs found in review:
 *  1. The global JWT preHandler verified the token but swallowed any
 *     verification failure, so a missing/invalid token never actually
 *     blocked a request.
 *  2. getMerchantId() (duplicated across positions.ts, sweep.ts, yields.ts,
 *     and index.ts's /api/v1/portfolio) fell back unconditionally to the
 *     client-supplied `x-merchant-id` header, letting any caller act as any
 *     merchant — including scheduling withdrawals on positions they don't own.
 *
 * These tests assert:
 *  - Requests with no token, or an invalid token, are rejected with 401
 *    before reaching a handler.
 *  - A valid JWT for merchant A cannot read or mutate merchant B's
 *    positions/sweep config/withdrawals via a spoofed `x-merchant-id`
 *    header — merchant identity always comes from the token, never the
 *    header.
 *  - Public routes (health probes, vault catalogue, /yields/apys) remain
 *    reachable without a token.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("../index");
const store_1 = require("../store");
let app;
function tokenFor(merchantId) {
    return app.jwt.sign({ merchantId });
}
function seedPosition(id, merchantId) {
    const now = new Date().toISOString();
    const position = {
        id,
        merchantId,
        vaultId: 'aave-v3-usdc-ethereum',
        principal: 5000,
        shares: 5000,
        currentValue: 5000,
        unrealizedYield: 0,
        realizedYield: 0,
        depositedAt: now,
        lastUpdatedAt: now,
        status: 'active',
    };
    store_1.positionsStore.set(id, position);
    return position;
}
(0, vitest_1.beforeAll)(async () => {
    app = await (0, index_1.buildApp)();
    await app.ready();
});
(0, vitest_1.afterAll)(async () => {
    await app.close();
});
(0, vitest_1.beforeEach)(() => {
    store_1.positionsStore.clear();
    store_1.sweepConfigStore.clear();
    store_1.txStore.clear();
});
(0, vitest_1.describe)('unauthenticated / invalid token → 401', () => {
    (0, vitest_1.it)('rejects GET /api/v1/positions with no Authorization header', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/v1/positions' });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
    (0, vitest_1.it)('rejects GET /api/v1/positions with a malformed Bearer token', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/positions',
            headers: { authorization: 'Bearer not-a-real-jwt' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
    (0, vitest_1.it)('rejects GET /api/v1/positions when only x-merchant-id is supplied (no token at all)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/positions',
            headers: { 'x-merchant-id': 'merchant-a' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
    (0, vitest_1.it)('rejects PUT /api/v1/sweep/config with no token', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/api/v1/sweep/config',
            payload: {
                enabled: true,
                idleThresholdUsd: 1000,
                targetVaultId: 'aave-v3-usdc-ethereum',
                keepReserveUsd: 500,
                autoCompound: false,
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
    (0, vitest_1.it)('rejects DELETE /api/v1/positions/:id (withdrawal) with no token', async () => {
        seedPosition('pos-1', 'merchant-a');
        const res = await app.inject({ method: 'DELETE', url: '/api/v1/positions/pos-1' });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
    (0, vitest_1.it)('rejects GET /api/v1/portfolio with an expired/garbage token', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/portfolio',
            headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.garbage.garbage' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
});
(0, vitest_1.describe)('public routes remain reachable without a token', () => {
    (0, vitest_1.it)('GET /healthz', async () => {
        const res = await app.inject({ method: 'GET', url: '/healthz' });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
    });
    (0, vitest_1.it)('GET /api/v1/vaults', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/v1/vaults' });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
    });
    (0, vitest_1.it)('GET /api/v1/yields/apys', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/v1/yields/apys' });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
    });
});
(0, vitest_1.describe)('merchant identity comes from the JWT, never x-merchant-id', () => {
    (0, vitest_1.it)('a valid token for merchant A cannot list merchant B positions via a spoofed header', async () => {
        seedPosition('pos-a', 'merchant-a');
        seedPosition('pos-b', 'merchant-b');
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/positions',
            headers: {
                authorization: `Bearer ${tokenFor('merchant-a')}`,
                'x-merchant-id': 'merchant-b',
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(body.data).toHaveLength(1);
        (0, vitest_1.expect)(body.data[0].id).toBe('pos-a');
    });
    (0, vitest_1.it)('a valid token for merchant A gets 403 reading merchant B\'s position by id, even with a spoofed header', async () => {
        seedPosition('pos-b', 'merchant-b');
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/positions/pos-b',
            headers: {
                authorization: `Bearer ${tokenFor('merchant-a')}`,
                'x-merchant-id': 'merchant-b',
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(403);
    });
    (0, vitest_1.it)('a valid token for merchant A cannot schedule a withdrawal on merchant B\'s position via a spoofed header', async () => {
        seedPosition('pos-b', 'merchant-b');
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/v1/positions/pos-b',
            headers: {
                authorization: `Bearer ${tokenFor('merchant-a')}`,
                'x-merchant-id': 'merchant-b',
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(403);
        // The position must be untouched — no withdrawal transaction created.
        const txs = [...store_1.txStore.values()].filter((t) => t.positionId === 'pos-b');
        (0, vitest_1.expect)(txs).toHaveLength(0);
    });
    (0, vitest_1.it)('a valid token for merchant A cannot read merchant B\'s sweep config via a spoofed header', async () => {
        store_1.sweepConfigStore.set('merchant-b', {
            merchantId: 'merchant-b',
            enabled: true,
            idleThresholdUsd: 2500,
            targetVaultId: 'aave-v3-usdc-ethereum',
            keepReserveUsd: 1000,
            autoCompound: true,
        });
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/sweep/config',
            headers: {
                authorization: `Bearer ${tokenFor('merchant-a')}`,
                'x-merchant-id': 'merchant-b',
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        // merchant-a has no config, so this must be the "not configured" default,
        // never merchant-b's real (idleThresholdUsd: 2500) config.
        (0, vitest_1.expect)(body.merchantId).toBe('merchant-a');
        (0, vitest_1.expect)(body.configured).toBe(false);
    });
    (0, vitest_1.it)('a valid token for merchant A writes sweep config under merchant A, never merchant B, despite a spoofed header', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/api/v1/sweep/config',
            headers: {
                authorization: `Bearer ${tokenFor('merchant-a')}`,
                'x-merchant-id': 'merchant-b',
            },
            payload: {
                enabled: true,
                idleThresholdUsd: 1000,
                targetVaultId: 'aave-v3-usdc-ethereum',
                keepReserveUsd: 500,
                autoCompound: false,
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        (0, vitest_1.expect)(store_1.sweepConfigStore.has('merchant-a')).toBe(true);
        (0, vitest_1.expect)(store_1.sweepConfigStore.has('merchant-b')).toBe(false);
    });
    (0, vitest_1.it)('legitimate same-merchant access still works end to end', async () => {
        seedPosition('pos-a', 'merchant-a');
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/positions/pos-a',
            headers: { authorization: `Bearer ${tokenFor('merchant-a')}` },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        (0, vitest_1.expect)(res.json().id).toBe('pos-a');
    });
});
//# sourceMappingURL=auth.test.js.map
"use strict";
/**
 * Integration tests for the RWA (Real-World Assets) Registry service.
 *
 * Uses Fastify's built-in app.inject() to exercise HTTP routes without
 * binding to a real port. The apiKeyAuth plugin allows any non-empty
 * key in non-production mode, so all non-health requests carry 'x-api-key'.
 *
 * Asset IDs are UUID-based (generated at module-load time in store.ts),
 * so we discover them via GET /v1/assets in beforeAll.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("../index");
const AUTH = { 'x-api-key': 'test-key' };
const MERCHANT_ID = 'test_mer_001';
async function makeApp() {
    const app = await (0, index_1.buildApp)();
    await app.ready();
    return app;
}
// ── Suite ─────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('RWA Registry', () => {
    let app;
    let assets = [];
    /** First available asset (lowest-minimum investment). */
    let firstAsset;
    (0, vitest_1.beforeAll)(async () => {
        app = await makeApp();
        // Discover the seeded assets (IDs are runtime UUIDs)
        const res = await app.inject({ method: 'GET', url: '/v1/assets', headers: AUTH });
        assets = res.json().data;
        // Pick the asset with the lowest minimum so tests can create cheap positions
        firstAsset = [...assets].sort((a, b) => a.minimumInvestmentUsd - b.minimumInvestmentUsd)[0];
    });
    (0, vitest_1.afterAll)(async () => {
        await app.close();
    });
    // ── Health ─────────────────────────────────────────────────────────────────
    (0, vitest_1.it)('GET /health returns 200 with service metadata', async () => {
        const res = await app.inject({ method: 'GET', url: '/health' });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(body.status).toBe('ok');
        (0, vitest_1.expect)(body.service).toBe('rwa-registry');
        (0, vitest_1.expect)(body.assetCount).toBeGreaterThan(0);
    });
    // ── GET /v1/assets ────────────────────────────────────────────────────────
    (0, vitest_1.it)('GET /v1/assets returns seeded asset list (USDY, FOBXX, TBILL, etc.)', async () => {
        const res = await app.inject({ method: 'GET', url: '/v1/assets', headers: AUTH });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(body.total).toBeGreaterThanOrEqual(6); // 6 seeded assets
        (0, vitest_1.expect)(Array.isArray(body.data)).toBe(true);
        const symbols = body.data.map((a) => a.symbol);
        (0, vitest_1.expect)(symbols).toContain('USDY');
        (0, vitest_1.expect)(symbols).toContain('FOBXX');
        (0, vitest_1.expect)(symbols).toContain('TBILL');
    });
    (0, vitest_1.it)('GET /v1/assets?assetClass=treasury_bill filters correctly', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/v1/assets?assetClass=treasury_bill',
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(body.data.length).toBeGreaterThan(0);
        body.data.forEach((a) => (0, vitest_1.expect)(a.assetClass).toBe('treasury_bill'));
    });
    (0, vitest_1.it)('GET /v1/assets?minApy=500 returns only high-yield assets', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/v1/assets?minApy=500',
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(body.data.length).toBeGreaterThan(0);
        body.data.forEach((a) => (0, vitest_1.expect)(a.currentApyBps).toBeGreaterThanOrEqual(500));
    });
    // ── GET /v1/assets/compare ────────────────────────────────────────────────
    (0, vitest_1.it)('GET /v1/assets/compare returns all assets sorted by APY', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/v1/assets/compare',
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        // compare endpoint returns { apyBps, symbol, ... } via getYieldComparison()
        const body = res.json();
        (0, vitest_1.expect)(Array.isArray(body.data)).toBe(true);
        (0, vitest_1.expect)(body.data.length).toBeGreaterThan(0);
        // Verify descending APY sort (compare items use 'apyBps', not 'currentApyBps')
        for (let i = 1; i < body.data.length; i++) {
            (0, vitest_1.expect)(body.data[i - 1].apyBps).toBeGreaterThanOrEqual(body.data[i].apyBps);
        }
    });
    // ── GET /v1/assets/:id ────────────────────────────────────────────────────
    (0, vitest_1.it)('GET /v1/assets/:id retrieves a single asset', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/v1/assets/${firstAsset.id}`,
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(body.data.id).toBe(firstAsset.id);
        (0, vitest_1.expect)(body.data.symbol).toBe(firstAsset.symbol);
    });
    (0, vitest_1.it)('GET /v1/assets/:id returns 404 for unknown asset', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/v1/assets/nonexistent-asset-uuid',
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(404);
        const body = res.json();
        (0, vitest_1.expect)(body.error).toBe('NotFound');
    });
    // ── POST /v1/positions ────────────────────────────────────────────────────
    (0, vitest_1.it)('POST /v1/positions opens a new position (merchantId, assetId, units, costBasisUsd)', async () => {
        // Use enough units so (units * nav) >= minimumInvestmentUsd
        const units = Math.ceil(firstAsset.minimumInvestmentUsd / firstAsset.nav) + 10;
        const costBasisUsd = units * firstAsset.nav;
        const res = await app.inject({
            method: 'POST',
            url: '/v1/positions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                assetId: firstAsset.id,
                units,
                costBasisUsd,
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(201);
        const body = res.json();
        (0, vitest_1.expect)(body.data['merchantId']).toBe(MERCHANT_ID);
        (0, vitest_1.expect)(body.data['assetId']).toBe(firstAsset.id);
        (0, vitest_1.expect)(body.data['units']).toBe(units);
        (0, vitest_1.expect)(typeof body.data['id']).toBe('string');
        (0, vitest_1.expect)(typeof body.data['currentValueUsd']).toBe('number');
    });
    (0, vitest_1.it)('POST /v1/positions with missing fields returns 400', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/positions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                // missing assetId, units, costBasisUsd
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(400);
        const body = res.json();
        (0, vitest_1.expect)(body.error).toBe('ValidationError');
    });
    (0, vitest_1.it)('POST /v1/positions returns 400 when units is below minimum investment', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/positions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                assetId: firstAsset.id,
                units: 0.001, // trivially small — way below minimum
                costBasisUsd: 0.001,
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(400);
    });
    (0, vitest_1.it)('POST /v1/positions returns 404 for unknown assetId', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/positions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                assetId: 'does-not-exist',
                units: 1000,
                costBasisUsd: 1000,
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(404);
    });
    // ── GET /v1/positions ─────────────────────────────────────────────────────
    (0, vitest_1.it)('GET /v1/positions?merchantId=test_mer_001 returns merchant positions', async () => {
        // Ensure at least one position exists for this merchant (previous test created one)
        const res = await app.inject({
            method: 'GET',
            url: `/v1/positions?merchantId=${MERCHANT_ID}`,
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(body.total).toBeGreaterThan(0);
        body.data.forEach((p) => (0, vitest_1.expect)(p.merchantId).toBe(MERCHANT_ID));
    });
    (0, vitest_1.it)('GET /v1/positions without merchantId returns 400', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/v1/positions',
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(400);
    });
    // ── GET /v1/positions/:id ─────────────────────────────────────────────────
    (0, vitest_1.it)('GET /v1/positions/:id retrieves single position', async () => {
        // Create a fresh position
        const units = Math.ceil(firstAsset.minimumInvestmentUsd / firstAsset.nav) + 5;
        const costBasisUsd = units * firstAsset.nav;
        const createRes = await app.inject({
            method: 'POST',
            url: '/v1/positions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                assetId: firstAsset.id,
                units,
                costBasisUsd,
            },
        });
        const positionId = createRes.json().data.id;
        const res = await app.inject({
            method: 'GET',
            url: `/v1/positions/${positionId}`,
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(body.data.id).toBe(positionId);
    });
    (0, vitest_1.it)('GET /v1/positions/:id returns 404 for unknown position', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/v1/positions/nonexistent-position-uuid',
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(404);
    });
    // ── PUT /v1/positions/:id/update-value ────────────────────────────────────
    (0, vitest_1.it)('PUT /v1/positions/:id/update-value triggers NAV refresh on position', async () => {
        const units = Math.ceil(firstAsset.minimumInvestmentUsd / firstAsset.nav) + 5;
        const costBasisUsd = units * firstAsset.nav;
        const createRes = await app.inject({
            method: 'POST',
            url: '/v1/positions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                assetId: firstAsset.id,
                units,
                costBasisUsd,
            },
        });
        const positionId = createRes.json().data.id;
        const res = await app.inject({
            method: 'PUT',
            url: `/v1/positions/${positionId}/update-value`,
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(body.data.id).toBe(positionId);
        (0, vitest_1.expect)(typeof body.data.currentValueUsd).toBe('number');
        (0, vitest_1.expect)(typeof body.data.lastUpdatedAt).toBe('string');
    });
    // ── GET /v1/income ────────────────────────────────────────────────────────
    (0, vitest_1.it)('GET /v1/income?merchantId=test_mer_001 returns income history', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/v1/income?merchantId=${MERCHANT_ID}`,
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(Array.isArray(body.data)).toBe(true);
        // May be empty if no income has been distributed yet, but the shape should be correct
        (0, vitest_1.expect)(typeof body.total).toBe('number');
    });
    (0, vitest_1.it)('GET /v1/income without merchantId returns 400', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/v1/income',
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(400);
    });
    // ── GET /v1/income/tax-summary ────────────────────────────────────────────
    (0, vitest_1.it)('GET /v1/income/tax-summary?merchantId=test_mer_001 returns tax summary', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/v1/income/tax-summary?merchantId=${MERCHANT_ID}`,
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(body.merchantId).toBe(MERCHANT_ID);
        (0, vitest_1.expect)(typeof body.totalTaxableIncome).toBe('number');
        (0, vitest_1.expect)(typeof body.distributionCount).toBe('number');
    });
    (0, vitest_1.it)('GET /v1/income/tax-summary without merchantId returns 400', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/v1/income/tax-summary',
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(400);
    });
    // ── POST /v1/redemptions ──────────────────────────────────────────────────
    (0, vitest_1.it)('POST /v1/redemptions creates a redemption request', async () => {
        // Calculate units such that we can redeem at least minimumRedemptionUsd worth.
        // We create a large-enough position, then redeem exactly the minimum redemption amount.
        const minRedeemUnits = Math.ceil(firstAsset.minimumRedemptionUsd / firstAsset.nav) + 5;
        // Total position must be >= minimumInvestmentUsd AND have enough units to redeem
        const totalUnits = Math.max(Math.ceil(firstAsset.minimumInvestmentUsd / firstAsset.nav) + 5, minRedeemUnits * 2);
        const costBasisUsd = totalUnits * firstAsset.nav;
        const createRes = await app.inject({
            method: 'POST',
            url: '/v1/positions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                assetId: firstAsset.id,
                units: totalUnits,
                costBasisUsd,
            },
        });
        (0, vitest_1.expect)(createRes.statusCode).toBe(201);
        const position = createRes.json().data;
        const res = await app.inject({
            method: 'POST',
            url: '/v1/redemptions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                assetId: position.assetId,
                positionId: position.id,
                units: minRedeemUnits,
                speed: firstAsset.symbol === 'OUSG' ? 'instant' : 'next_day',
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(201);
        const body = res.json();
        (0, vitest_1.expect)(body.data.merchantId).toBe(MERCHANT_ID);
        (0, vitest_1.expect)(body.data.positionId).toBe(position.id);
        (0, vitest_1.expect)(body.data.status).toBe('pending');
        (0, vitest_1.expect)(body.data.requestedUnits).toBe(minRedeemUnits);
        (0, vitest_1.expect)(typeof body.data.id).toBe('string');
    });
    (0, vitest_1.it)('POST /v1/redemptions with missing required fields returns 400', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/redemptions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                // missing assetId, positionId, units
            },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(400);
    });
    // ── GET /v1/redemptions ───────────────────────────────────────────────────
    (0, vitest_1.it)('GET /v1/redemptions?merchantId=test_mer_001 lists redemptions', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/v1/redemptions?merchantId=${MERCHANT_ID}`,
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(Array.isArray(body.data)).toBe(true);
        (0, vitest_1.expect)(typeof body.total).toBe('number');
    });
    (0, vitest_1.it)('GET /v1/redemptions without merchantId returns 400', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/v1/redemptions',
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(400);
    });
    // ── GET /v1/redemptions/:id ───────────────────────────────────────────────
    (0, vitest_1.it)('GET /v1/redemptions/:id retrieves a single redemption', async () => {
        // Create a position large enough to redeem the minimum redemption amount
        const minRedeemUnits = Math.ceil(firstAsset.minimumRedemptionUsd / firstAsset.nav) + 5;
        const totalUnits = Math.max(Math.ceil(firstAsset.minimumInvestmentUsd / firstAsset.nav) + 5, minRedeemUnits * 2);
        const costBasisUsd = totalUnits * firstAsset.nav;
        const posRes = await app.inject({
            method: 'POST',
            url: '/v1/positions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                assetId: firstAsset.id,
                units: totalUnits,
                costBasisUsd,
            },
        });
        const position = posRes.json().data;
        const redRes = await app.inject({
            method: 'POST',
            url: '/v1/redemptions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                assetId: position.assetId,
                positionId: position.id,
                units: minRedeemUnits,
            },
        });
        (0, vitest_1.expect)(redRes.statusCode).toBe(201);
        const redemptionId = redRes.json().data.id;
        const res = await app.inject({
            method: 'GET',
            url: `/v1/redemptions/${redemptionId}`,
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(body.data.id).toBe(redemptionId);
    });
    (0, vitest_1.it)('GET /v1/redemptions/:id returns 404 for unknown redemption', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/v1/redemptions/nonexistent-redemption-uuid',
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(404);
    });
    // ── POST /v1/redemptions/:id/cancel ──────────────────────────────────────
    (0, vitest_1.it)('POST /v1/redemptions/:id/cancel cancels a pending redemption', async () => {
        // Create a position large enough to redeem above the minimum redemption amount
        const minRedeemUnits = Math.ceil(firstAsset.minimumRedemptionUsd / firstAsset.nav) + 5;
        const totalUnits = Math.max(Math.ceil(firstAsset.minimumInvestmentUsd / firstAsset.nav) + 5, minRedeemUnits * 2);
        const costBasisUsd = totalUnits * firstAsset.nav;
        const posRes = await app.inject({
            method: 'POST',
            url: '/v1/positions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                assetId: firstAsset.id,
                units: totalUnits,
                costBasisUsd,
            },
        });
        const position = posRes.json().data;
        const redRes = await app.inject({
            method: 'POST',
            url: '/v1/redemptions',
            headers: AUTH,
            payload: {
                merchantId: MERCHANT_ID,
                assetId: position.assetId,
                positionId: position.id,
                units: minRedeemUnits,
            },
        });
        (0, vitest_1.expect)(redRes.statusCode).toBe(201);
        const redemptionId = redRes.json().data.id;
        const cancelRes = await app.inject({
            method: 'POST',
            url: `/v1/redemptions/${redemptionId}/cancel`,
            headers: AUTH,
        });
        (0, vitest_1.expect)(cancelRes.statusCode).toBe(200);
        const body = cancelRes.json();
        (0, vitest_1.expect)(body.success).toBe(true);
    });
    // ── POST /v1/nav/refresh ──────────────────────────────────────────────────
    (0, vitest_1.it)('POST /v1/nav/refresh triggers NAV refresh for all assets', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/nav/refresh',
            headers: AUTH,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = res.json();
        (0, vitest_1.expect)(body.success).toBe(true);
        (0, vitest_1.expect)(body.assetCount).toBeGreaterThan(0);
    });
    // ── Auth enforcement ─────────────────────────────────────────────────────
    (0, vitest_1.it)('Requests without X-Api-Key return 401', async () => {
        const res = await app.inject({ method: 'GET', url: '/v1/assets' });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
    (0, vitest_1.it)('GET /health does not require auth', async () => {
        const res = await app.inject({ method: 'GET', url: '/health' });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
    });
});
//# sourceMappingURL=rwa-registry.test.js.map
"use strict";
/**
 * Security regression tests for rwa-registry.
 *
 * Covers three fixes:
 *   1. Production auth fails closed when VALID_API_KEYS is missing/placeholder/
 *      too short, instead of silently accepting any non-empty key
 *      (`validKeys.size > 0` collapsing to false was the original bug).
 *   2. Production boot fails when CORS_ORIGIN is unset or still '*'.
 *   3. Per-merchant ownership: a merchant-scoped key may only read/mutate its
 *      own positions and redemption requests — not another merchant's, by
 *      varying `:id` or `merchantId`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("../index");
// ── Production auth: fail closed, not open ───────────────────────────────────
(0, vitest_1.describe)('Production auth fails closed', () => {
    const ENV_KEYS = ['NODE_ENV', 'VALID_API_KEYS', 'MERCHANT_API_KEYS', 'CORS_ORIGIN'];
    let saved;
    (0, vitest_1.beforeAll)(() => {
        saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    });
    (0, vitest_1.afterAll)(() => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined)
                delete process.env[k];
            else
                process.env[k] = saved[k];
        }
    });
    (0, vitest_1.it)('refuses to boot in production when VALID_API_KEYS is not configured', async () => {
        process.env['NODE_ENV'] = 'production';
        process.env['CORS_ORIGIN'] = 'https://dashboard.forgepay.io';
        delete process.env['VALID_API_KEYS'];
        delete process.env['MERCHANT_API_KEYS'];
        await (0, vitest_1.expect)((0, index_1.buildApp)()).rejects.toThrow(/VALID_API_KEYS is not set/);
    });
    (0, vitest_1.it)('refuses to boot in production when VALID_API_KEYS is the dev placeholder', async () => {
        process.env['NODE_ENV'] = 'production';
        process.env['CORS_ORIGIN'] = 'https://dashboard.forgepay.io';
        process.env['VALID_API_KEYS'] = 'dev-rwa-registry-key';
        await (0, vitest_1.expect)((0, index_1.buildApp)()).rejects.toThrow(/development placeholder/);
    });
    (0, vitest_1.it)('refuses to boot in production when a configured key is too short', async () => {
        process.env['NODE_ENV'] = 'production';
        process.env['CORS_ORIGIN'] = 'https://dashboard.forgepay.io';
        process.env['VALID_API_KEYS'] = 'short-key';
        await (0, vitest_1.expect)((0, index_1.buildApp)()).rejects.toThrow(/at least 32 characters/);
    });
    (0, vitest_1.it)('boots in production with a sufficiently long VALID_API_KEYS and explicit CORS_ORIGIN', async () => {
        process.env['NODE_ENV'] = 'production';
        process.env['CORS_ORIGIN'] = 'https://dashboard.forgepay.io';
        process.env['VALID_API_KEYS'] = 'a'.repeat(40);
        const prodApp = await (0, index_1.buildApp)();
        await prodApp.ready();
        await prodApp.close();
    });
});
// ── Production CORS: fail closed, not open ───────────────────────────────────
(0, vitest_1.describe)('Production CORS fails closed', () => {
    const ENV_KEYS = ['NODE_ENV', 'VALID_API_KEYS', 'CORS_ORIGIN'];
    let saved;
    (0, vitest_1.beforeAll)(() => {
        saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
        process.env['VALID_API_KEYS'] = 'a'.repeat(40);
    });
    (0, vitest_1.afterAll)(() => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined)
                delete process.env[k];
            else
                process.env[k] = saved[k];
        }
    });
    (0, vitest_1.it)('refuses to boot in production when CORS_ORIGIN is not configured', async () => {
        process.env['NODE_ENV'] = 'production';
        delete process.env['CORS_ORIGIN'];
        await (0, vitest_1.expect)((0, index_1.buildApp)()).rejects.toThrow(/CORS_ORIGIN is not set/);
    });
    (0, vitest_1.it)('refuses to boot in production when CORS_ORIGIN is still "*"', async () => {
        process.env['NODE_ENV'] = 'production';
        process.env['CORS_ORIGIN'] = '*';
        await (0, vitest_1.expect)((0, index_1.buildApp)()).rejects.toThrow(/CORS_ORIGIN is not set/);
    });
    (0, vitest_1.it)('boots in production with an explicit CORS_ORIGIN', async () => {
        process.env['NODE_ENV'] = 'production';
        process.env['CORS_ORIGIN'] = 'https://dashboard.forgepay.io,https://app.forgepay.io';
        const prodApp = await (0, index_1.buildApp)();
        await prodApp.ready();
        await prodApp.close();
    });
});
// ── Per-merchant ownership ────────────────────────────────────────────────────
//
// Regression coverage for the bug where any valid key — with no notion of
// which merchant it belonged to — could read or mutate any other merchant's
// RWA position or redemption request by varying `:id`/`merchantId`.
// MERCHANT_API_KEYS gives each key an identity; merchantAccessError enforces
// that a non-admin caller may only act on resources it owns (403, never 404,
// on mismatch).
(0, vitest_1.describe)('Per-merchant ownership', () => {
    const MERCHANT_A_KEY = 'merchant-a-key-00000000000000000000000';
    const MERCHANT_B_KEY = 'merchant-b-key-00000000000000000000000';
    const ADMIN_KEY = 'ownership-admin-key-0000000000000000000';
    const AUTH_A = { 'x-api-key': MERCHANT_A_KEY };
    const AUTH_B = { 'x-api-key': MERCHANT_B_KEY };
    const AUTH_ADMIN = { 'x-api-key': ADMIN_KEY };
    let ownershipApp;
    let savedMerchantKeys;
    let savedValidKeys;
    let assetId;
    (0, vitest_1.beforeAll)(async () => {
        savedMerchantKeys = process.env['MERCHANT_API_KEYS'];
        savedValidKeys = process.env['VALID_API_KEYS'];
        process.env['MERCHANT_API_KEYS'] = `merchant-a:${MERCHANT_A_KEY},merchant-b:${MERCHANT_B_KEY}`;
        process.env['VALID_API_KEYS'] = ADMIN_KEY;
        ownershipApp = await (0, index_1.buildApp)();
        await ownershipApp.ready();
        const assetsRes = await ownershipApp.inject({ method: 'GET', url: '/v1/assets', headers: AUTH_ADMIN });
        const assets = assetsRes.json().data;
        const cheapest = [...assets].sort((a, b) => a.minimumInvestmentUsd - b.minimumInvestmentUsd)[0];
        assetId = cheapest.id;
    });
    (0, vitest_1.afterAll)(async () => {
        await ownershipApp.close();
        if (savedMerchantKeys === undefined)
            delete process.env['MERCHANT_API_KEYS'];
        else
            process.env['MERCHANT_API_KEYS'] = savedMerchantKeys;
        if (savedValidKeys === undefined)
            delete process.env['VALID_API_KEYS'];
        else
            process.env['VALID_API_KEYS'] = savedValidKeys;
    });
    async function openPositionForMerchantA() {
        const assetsRes = await ownershipApp.inject({ method: 'GET', url: `/v1/assets/${assetId}`, headers: AUTH_A });
        const asset = assetsRes.json().data;
        const units = Math.ceil(asset.minimumInvestmentUsd / asset.nav) + 10;
        const res = await ownershipApp.inject({
            method: 'POST',
            url: '/v1/positions',
            headers: AUTH_A,
            payload: { merchantId: 'merchant-a', assetId, units, costBasisUsd: units * asset.nav },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(201);
        return res.json().data;
    }
    (0, vitest_1.it)('a merchant key cannot open a position claiming to be a different merchant', async () => {
        const res = await ownershipApp.inject({
            method: 'POST',
            url: '/v1/positions',
            headers: AUTH_A,
            payload: { merchantId: 'merchant-b', assetId, units: 1000, costBasisUsd: 1000 },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(403);
    });
    (0, vitest_1.it)('owner can read its own position; a different merchant gets 403 not 404; admin can read any', async () => {
        const position = await openPositionForMerchantA();
        const ownRes = await ownershipApp.inject({ method: 'GET', url: `/v1/positions/${position.id}`, headers: AUTH_A });
        (0, vitest_1.expect)(ownRes.statusCode).toBe(200);
        const otherRes = await ownershipApp.inject({ method: 'GET', url: `/v1/positions/${position.id}`, headers: AUTH_B });
        (0, vitest_1.expect)(otherRes.statusCode).toBe(403);
        const adminRes = await ownershipApp.inject({ method: 'GET', url: `/v1/positions/${position.id}`, headers: AUTH_ADMIN });
        (0, vitest_1.expect)(adminRes.statusCode).toBe(200);
    });
    (0, vitest_1.it)('a different merchant cannot update-value another merchant\'s position', async () => {
        const position = await openPositionForMerchantA();
        const res = await ownershipApp.inject({
            method: 'PUT',
            url: `/v1/positions/${position.id}/update-value`,
            headers: AUTH_B,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(403);
    });
    (0, vitest_1.it)('a merchant cannot list another merchant\'s positions via the merchantId query param', async () => {
        await openPositionForMerchantA();
        const res = await ownershipApp.inject({
            method: 'GET',
            url: '/v1/positions?merchantId=merchant-a',
            headers: AUTH_B,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(403);
    });
    (0, vitest_1.it)('a different merchant cannot read, process, or cancel another merchant\'s redemption request', async () => {
        const position = await openPositionForMerchantA();
        const assetRes = await ownershipApp.inject({ method: 'GET', url: `/v1/assets/${assetId}`, headers: AUTH_A });
        const asset = assetRes.json().data;
        const redeemUnits = Math.ceil(asset.minimumRedemptionUsd / asset.nav) + 1;
        const redRes = await ownershipApp.inject({
            method: 'POST',
            url: '/v1/redemptions',
            headers: AUTH_A,
            payload: { merchantId: 'merchant-a', assetId, positionId: position.id, units: redeemUnits },
        });
        (0, vitest_1.expect)(redRes.statusCode).toBe(201);
        const redemptionId = redRes.json().data.id;
        const readRes = await ownershipApp.inject({ method: 'GET', url: `/v1/redemptions/${redemptionId}`, headers: AUTH_B });
        (0, vitest_1.expect)(readRes.statusCode).toBe(403);
        const processRes = await ownershipApp.inject({ method: 'POST', url: `/v1/redemptions/${redemptionId}/process`, headers: AUTH_B });
        (0, vitest_1.expect)(processRes.statusCode).toBe(403);
        const cancelRes = await ownershipApp.inject({ method: 'POST', url: `/v1/redemptions/${redemptionId}/cancel`, headers: AUTH_B });
        (0, vitest_1.expect)(cancelRes.statusCode).toBe(403);
        // Owner can still cancel it.
        const ownerCancelRes = await ownershipApp.inject({ method: 'POST', url: `/v1/redemptions/${redemptionId}/cancel`, headers: AUTH_A });
        (0, vitest_1.expect)(ownerCancelRes.statusCode).toBe(200);
    });
});
//# sourceMappingURL=security.test.js.map
"use strict";
/**
 * Unit tests for redemption settlement accounting (src/redemption.ts).
 *
 * These construct isolated test assets/positions directly via the store
 * (rather than going through HTTP) so the numbers (NAV, fee %, cost basis)
 * are fully controlled and the accounting math can be asserted precisely.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const uuid_1 = require("uuid");
const store_1 = require("../store");
const redemption_1 = require("../redemption");
const MERCHANT_ID = 'test_merchant_redemption';
function makeAsset(overrides = {}) {
    const now = new Date().toISOString();
    const asset = {
        id: (0, uuid_1.v4)(),
        name: 'Test T-Bill Fund',
        symbol: 'TEST' + Math.random().toString(36).slice(2, 6).toUpperCase(),
        issuer: 'Test Issuer',
        assetClass: 'treasury_bill',
        description: 'Test asset for redemption unit tests',
        currentApyBps: 500,
        historicalApy30dBps: 500,
        historicalApy90dBps: 500,
        yieldFrequency: 'daily',
        incomeType: 'interest',
        taxTreatment: 'ordinary_income',
        redemptionSpeed: 'instant',
        minimumInvestmentUsd: 1,
        minimumRedemptionUsd: 1,
        redemptionFeePercent: 0,
        requiresKyc: false,
        requiresAccreditedInvestor: false,
        supportedJurisdictions: ['all'],
        status: 'active',
        totalAumUsd: 1_000_000,
        nav: 1.0,
        navUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
    store_1.rwaAssets.set(asset.id, asset);
    return asset;
}
function makePosition(assetId, overrides = {}) {
    const now = new Date().toISOString();
    const position = {
        id: (0, uuid_1.v4)(),
        merchantId: MERCHANT_ID,
        assetId,
        units: 100,
        costBasisUsd: 100,
        currentValueUsd: 100,
        unrealizedGainUsd: 0,
        totalIncomeEarnedUsd: 0,
        pendingIncomeUsd: 0,
        pendingRedemptionUnits: 0,
        pendingRedemptionUsd: 0,
        openedAt: now,
        lastUpdatedAt: now,
        ...overrides,
    };
    store_1.positions.set(position.id, position);
    return position;
}
(0, vitest_1.describe)('redemption settlement accounting', () => {
    (0, vitest_1.describe)('createRedemptionRequest', () => {
        (0, vitest_1.it)('places a pending-redemption hold without touching position.units', () => {
            const asset = makeAsset({ nav: 1.0 });
            const position = makePosition(asset.id, { units: 100, costBasisUsd: 100 });
            const request = (0, redemption_1.createRedemptionRequest)(MERCHANT_ID, asset.id, position.id, 40);
            (0, vitest_1.expect)(request.status).toBe('pending');
            (0, vitest_1.expect)(request.requestedUnits).toBe(40);
            (0, vitest_1.expect)(request.estimatedValueUsd).toBeCloseTo(40, 6);
            // Hold is placed...
            (0, vitest_1.expect)(position.pendingRedemptionUnits).toBe(40);
            (0, vitest_1.expect)(position.pendingRedemptionUsd).toBeCloseTo(40, 6);
            // ...but units are NOT removed yet (that only happens on processRedemption).
            (0, vitest_1.expect)(position.units).toBe(100);
        });
        (0, vitest_1.it)('rejects a request that exceeds available (non-held) units', () => {
            const asset = makeAsset({ nav: 1.0 });
            const position = makePosition(asset.id, { units: 100, costBasisUsd: 100 });
            (0, redemption_1.createRedemptionRequest)(MERCHANT_ID, asset.id, position.id, 60);
            (0, vitest_1.expect)(() => (0, redemption_1.createRedemptionRequest)(MERCHANT_ID, asset.id, position.id, 60)).toThrow(/exceeds available/);
        });
    });
    (0, vitest_1.describe)('processRedemption', () => {
        (0, vitest_1.it)('deducts units from the position and releases the pending-redemption hold', () => {
            const asset = makeAsset({ nav: 1.0 });
            const position = makePosition(asset.id, { units: 100, costBasisUsd: 100, currentValueUsd: 100 });
            const request = (0, redemption_1.createRedemptionRequest)(MERCHANT_ID, asset.id, position.id, 40);
            const settled = (0, redemption_1.processRedemption)(request.id);
            (0, vitest_1.expect)(settled.status).toBe('settled');
            (0, vitest_1.expect)(settled.actualSettlementAt).toBeTruthy();
            // Units actually deducted.
            (0, vitest_1.expect)(position.units).toBe(60);
            // Hold fully released (not partially, not left dangling).
            (0, vitest_1.expect)(position.pendingRedemptionUnits).toBe(0);
            (0, vitest_1.expect)(position.pendingRedemptionUsd).toBeCloseTo(0, 6);
        });
        (0, vitest_1.it)('uses the CURRENT NAV at processing time, not the stale estimate from request time', () => {
            const asset = makeAsset({ nav: 1.0 });
            const position = makePosition(asset.id, { units: 100, costBasisUsd: 100, currentValueUsd: 100 });
            const request = (0, redemption_1.createRedemptionRequest)(MERCHANT_ID, asset.id, position.id, 40);
            (0, vitest_1.expect)(request.estimatedValueUsd).toBeCloseTo(40, 6);
            // NAV moves up before settlement.
            asset.nav = 1.10;
            const settled = (0, redemption_1.processRedemption)(request.id);
            // actualValueUsd (before fee) should reflect the NEW nav: 40 * 1.10 = 44
            (0, vitest_1.expect)(settled.actualValueUsd).toBeCloseTo(44, 6);
        });
        (0, vitest_1.it)('computes redemption fee and net proceeds correctly for a non-zero fee asset', () => {
            const asset = makeAsset({ nav: 2.0, redemptionFeePercent: 2.5 });
            const position = makePosition(asset.id, { units: 100, costBasisUsd: 200, currentValueUsd: 200 });
            const request = (0, redemption_1.createRedemptionRequest)(MERCHANT_ID, asset.id, position.id, 50);
            const settled = (0, redemption_1.processRedemption)(request.id);
            // actualValueUsd = 50 * 2.0 = 100; fee = 2.5% of 100 = 2.5; net = 97.5
            (0, vitest_1.expect)(settled.actualValueUsd).toBeCloseTo(97.5, 6);
        });
        (0, vitest_1.it)('computes realized gain/loss using the correct per-unit cost basis (regression: denominator must not double-count redeemed units)', () => {
            // units=100, costBasis=100 => cost/unit = 1. NAV=1, no fee => no gain or loss on redemption.
            const asset = makeAsset({ nav: 1.0, redemptionFeePercent: 0 });
            const position = makePosition(asset.id, { units: 100, costBasisUsd: 100, currentValueUsd: 100 });
            const request = (0, redemption_1.createRedemptionRequest)(MERCHANT_ID, asset.id, position.id, 50);
            (0, redemption_1.processRedemption)(request.id);
            // Redeeming 50 units at cost-basis-per-unit of 1.0 => 50 of cost basis removed,
            // leaving exactly 50 (NOT ~33.33, which is what the previous buggy
            // "position.units + request.requestedUnits" denominator produced).
            (0, vitest_1.expect)(position.costBasisUsd).toBeCloseTo(50, 6);
            (0, vitest_1.expect)(position.units).toBe(50);
            // No realized gain/loss should have been recorded (net proceeds == cost basis redeemed).
            (0, vitest_1.expect)(position.unrealizedGainUsd).toBeCloseTo(position.currentValueUsd - position.costBasisUsd, 6);
        });
        (0, vitest_1.it)('rejects processing the same redemption twice', () => {
            const asset = makeAsset({ nav: 1.0 });
            const position = makePosition(asset.id, { units: 100, costBasisUsd: 100, currentValueUsd: 100 });
            const request = (0, redemption_1.createRedemptionRequest)(MERCHANT_ID, asset.id, position.id, 20);
            (0, redemption_1.processRedemption)(request.id);
            (0, vitest_1.expect)(() => (0, redemption_1.processRedemption)(request.id)).toThrow(/Cannot process redemption in status 'settled'/);
            // Units/hold must not be double-deducted by the rejected second call.
            (0, vitest_1.expect)(position.units).toBe(80);
            (0, vitest_1.expect)(position.pendingRedemptionUnits).toBe(0);
        });
    });
    (0, vitest_1.describe)('cancelRedemption', () => {
        (0, vitest_1.it)('restores the hold and leaves units untouched', () => {
            const asset = makeAsset({ nav: 1.0 });
            const position = makePosition(asset.id, { units: 100, costBasisUsd: 100, currentValueUsd: 100 });
            const request = (0, redemption_1.createRedemptionRequest)(MERCHANT_ID, asset.id, position.id, 30);
            (0, redemption_1.cancelRedemption)(request.id);
            (0, vitest_1.expect)(store_1.redemptionRequests.get(request.id).status).toBe('cancelled');
            (0, vitest_1.expect)(position.pendingRedemptionUnits).toBe(0);
            (0, vitest_1.expect)(position.pendingRedemptionUsd).toBeCloseTo(0, 6);
            (0, vitest_1.expect)(position.units).toBe(100);
        });
    });
});
//# sourceMappingURL=redemption.test.js.map
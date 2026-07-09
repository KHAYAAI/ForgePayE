/**
 * Unit tests for real income accrual/distribution math (src/income.ts).
 *
 * Verifies accrual is driven by actual elapsed time x actual position value
 * x actual asset APY — not a flat heuristic (e.g. a fixed "one day" or a
 * fixed dollar amount) applied regardless of how much time has really
 * passed.
 */

import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { rwaAssets, positions } from '../store';
import { accruePositionIncome, distributeIncome, calculateDailyIncome } from '../income';
import type { RWAAsset, MerchantRWAPosition } from '../types';

const MERCHANT_ID = 'test_merchant_income';

function makeAsset(overrides: Partial<RWAAsset> = {}): RWAAsset {
  const now = new Date().toISOString();
  const asset: RWAAsset = {
    id: uuidv4(),
    name: 'Test Income Fund',
    symbol: 'TINC' + Math.random().toString(36).slice(2, 6).toUpperCase(),
    issuer: 'Test Issuer',
    assetClass: 'treasury_bill',
    description: 'Test asset for income accrual unit tests',
    currentApyBps: 730, // 7.30% APY -> exactly 0.02/year per $1 for easy math (730/10000=0.073... use a round number below)
    historicalApy30dBps: 730,
    historicalApy90dBps: 730,
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
  rwaAssets.set(asset.id, asset);
  return asset;
}

function makePosition(
  assetId: string,
  overrides: Partial<MerchantRWAPosition> = {},
): MerchantRWAPosition {
  const now = new Date().toISOString();
  const position: MerchantRWAPosition = {
    id: uuidv4(),
    merchantId: MERCHANT_ID,
    assetId,
    units: 1000,
    costBasisUsd: 1000,
    currentValueUsd: 1000,
    unrealizedGainUsd: 0,
    totalIncomeEarnedUsd: 0,
    pendingIncomeUsd: 0,
    pendingRedemptionUnits: 0,
    pendingRedemptionUsd: 0,
    openedAt: now,
    lastUpdatedAt: now,
    ...overrides,
  };
  positions.set(position.id, position);
  return position;
}

describe('real income accrual (no flat heuristic)', () => {
  it('accrues proportionally to actual elapsed time, not a flat "one day" amount', () => {
    // 10% APY, $1000 position => $100/year => ~$0.2740/day at simple pro-rata.
    const asset = makeAsset({ currentApyBps: 1000 });
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const position = makePosition(asset.id, {
      currentValueUsd: 1000,
      lastAccrualAt: tenDaysAgo.toISOString(),
      openedAt: tenDaysAgo.toISOString(),
    });

    const now = new Date();
    const accrued = accruePositionIncome(position, asset, now);

    // Expected: 1000 * 0.10 * (10/365) ≈ 2.7397
    const expected = (1000 * 1000) / 10_000 * (10 / 365);
    expect(accrued).toBeCloseTo(expected, 6);
    expect(position.pendingIncomeUsd).toBeCloseTo(expected, 6);

    // Critically, this must NOT equal a flat single-day accrual (the old
    // heuristic), which would be ~10x smaller.
    const oneDayFlat = calculateDailyIncome(position, asset);
    expect(accrued).toBeGreaterThan(oneDayFlat * 5);

    // lastAccrualAt should be advanced to `now`, not left stale.
    expect(position.lastAccrualAt).toBe(now.toISOString());
  });

  it('accrues near-zero income immediately after opening a position (no elapsed time)', () => {
    const asset = makeAsset({ currentApyBps: 500 });
    const position = makePosition(asset.id); // lastAccrualAt defaults via openedAt = now

    const accrued = accruePositionIncome(position, asset, new Date());
    expect(accrued).toBeCloseTo(0, 6);
  });

  it('distributeIncome true-ups real elapsed-time accrual before settling, and rejects when nothing has accrued', () => {
    const asset = makeAsset({ currentApyBps: 500 });

    // Position opened moments ago: nothing meaningful has accrued yet.
    const freshPosition = makePosition(asset.id, { currentValueUsd: 1000 });
    expect(() => distributeIncome(MERCHANT_ID, asset.id, freshPosition.id)).toThrow(
      /No pending income to distribute/,
    );

    // Position whose last accrual was 30 days ago: real elapsed-time based
    // income should be distributed, not a flat heuristic amount.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const oldPosition = makePosition(asset.id, {
      currentValueUsd: 1000,
      lastAccrualAt: thirtyDaysAgo.toISOString(),
      openedAt: thirtyDaysAgo.toISOString(),
    });

    const dist = distributeIncome(MERCHANT_ID, asset.id, oldPosition.id);

    const expected = (1000 * 500) / 10_000 * (30 / 365);
    expect(dist.amountUsd).toBeCloseTo(expected, 6);
    expect(dist.status).toBe('settled');
    expect(dist.settledAt).toBe(dist.distributionDate);
    expect(oldPosition.pendingIncomeUsd).toBe(0);
    expect(oldPosition.totalIncomeEarnedUsd).toBeCloseTo(expected, 6);
  });

  it('scales with the asset\'s actual APY, not a fixed dollar amount regardless of asset', () => {
    const lowApyAsset = makeAsset({ currentApyBps: 100 }); // 1%
    const highApyAsset = makeAsset({ currentApyBps: 1000 }); // 10%
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    const lowPos = makePosition(lowApyAsset.id, {
      currentValueUsd: 10_000,
      lastAccrualAt: oneYearAgo.toISOString(),
      openedAt: oneYearAgo.toISOString(),
    });
    const highPos = makePosition(highApyAsset.id, {
      currentValueUsd: 10_000,
      lastAccrualAt: oneYearAgo.toISOString(),
      openedAt: oneYearAgo.toISOString(),
    });

    const now = new Date();
    const lowAccrued = accruePositionIncome(lowPos, lowApyAsset, now);
    const highAccrued = accruePositionIncome(highPos, highApyAsset, now);

    // Same value, same elapsed time, 10x the APY => ~10x the accrued income.
    expect(highAccrued / lowAccrued).toBeCloseTo(10, 1);
  });
});

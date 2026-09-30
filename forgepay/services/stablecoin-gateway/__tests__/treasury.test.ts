import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { planReplenishment, planColdSweep, unitsToUsdMicro, resolveTreasuryConfig, TreasuryConfigError, treasuryRequested } from '../src/lib/treasury.js';
import { dustReturnWei } from '../src/lib/sweeper.js';
import { RATE_SCALE, rateToScaled } from '../src/lib/asset-math.js';

const U = (n: number) => BigInt(n) * 1_000_000n; // 6-decimal units

describe('replenishing the payout wallet', () => {
  const base = { lowUnits: U(500), targetUnits: U(2000), approvedQueueUnits: 0n, warmBalance: U(50_000), capLeftUnits: U(10_000) };

  it('does nothing while the wallet is above its floor', () => {
    expect(planReplenishment({ ...base, balance: U(500) })).toEqual({ send: 0n, shortfall: 0n });
    expect(planReplenishment({ ...base, balance: U(1500) })).toEqual({ send: 0n, shortfall: 0n });
  });

  it('tops up to the target when it falls below the floor', () => {
    expect(planReplenishment({ ...base, balance: U(100) })).toEqual({ send: U(1900), shortfall: 0n });
    expect(planReplenishment({ ...base, balance: 0n })).toEqual({ send: U(2000), shortfall: 0n });
  });

  it('raises the floor to cover approved payouts already waiting, so none fails for lack of funds that exist', () => {
    // $8,000 of approved payouts queued and only $1,500 in the wallet: fund the queue plus the minimum
    const p = planReplenishment({ ...base, balance: U(1500), approvedQueueUnits: U(8000) });
    expect(p.send).toBe(U(8000) + U(500) - U(1500));
    expect(p.shortfall).toBe(0n);
  });

  it('never sends more than the operating wallet holds, and reports what is missing', () => {
    const p = planReplenishment({ ...base, balance: U(100), warmBalance: U(300) });
    expect(p.send).toBe(U(300));
    expect(p.shortfall).toBe(U(500) - U(100) - U(300)); // enough to reach the floor would be 400; only 300 could be sent
  });

  it('respects the daily cap, and reports the rest as a shortfall instead of raising it', () => {
    const p = planReplenishment({ ...base, balance: 0n, capLeftUnits: U(200) });
    expect(p.send).toBe(U(200));
    expect(p.shortfall).toBe(U(500) - U(200));
    expect(planReplenishment({ ...base, balance: 0n, capLeftUnits: 0n })).toEqual({ send: 0n, shortfall: U(500) });
  });

  it('no shortfall when what it could send already reaches the floor', () => {
    expect(planReplenishment({ ...base, balance: U(100), warmBalance: U(450) }).shortfall).toBe(0n);
  });
});

describe('moving surplus to cold storage', () => {
  it('only acts above the ceiling, and leaves the target behind', () => {
    expect(planColdSweep(U(20_000), U(25_000), U(5_000))).toBe(0n);
    expect(planColdSweep(U(25_000), U(25_000), U(5_000))).toBe(0n);
    expect(planColdSweep(U(30_000), U(25_000), U(5_000))).toBe(U(25_000));
  });
});

describe('valuing a balance', () => {
  it('dollar tokens at par; a rand token through the rate, with 18 decimals', () => {
    expect(unitsToUsdMicro(U(25), 6, RATE_SCALE)).toBe(25_000_000n);
    expect(unitsToUsdMicro(185n * 10n ** 18n, 18, rateToScaled('18.5'))).toBe(10_000_000n); // R185 at 18.5 = $10
  });
});

describe('returning dust from a swept address', () => {
  const fee = 2_000_000_000n; // 2 gwei
  it('returns what is left, less the cost of the return', () => {
    const cost = 21_000n * fee;
    expect(dustReturnWei(10n * cost, fee)).toBe(9n * cost);
  });
  it('does not bother when the remainder would barely cover the return itself', () => {
    const cost = 21_000n * fee;
    expect(dustReturnWei(cost, fee)).toBe(0n);
    expect(dustReturnWei(cost + cost / 8n, fee)).toBe(0n);
    expect(dustReturnWei(0n, fee)).toBe(0n);
  });
});

describe('treasury configuration fails closed', () => {
  const payout = ethers.Wallet.createRandom().address;
  const warmKey = ethers.Wallet.createRandom().privateKey;
  const ok = { TREASURY_MANAGER_ENABLED: 'true', TREASURY_WARM_PRIVATE_KEY: warmKey } as NodeJS.ProcessEnv;

  it('is off unless asked for', () => { expect(treasuryRequested({})).toBe(false); expect(treasuryRequested(ok)).toBe(true); });
  it('accepts a complete configuration', () => {
    const c = resolveTreasuryConfig(ok, payout);
    expect(c).toMatchObject({ chain: 'base', lowUsd: 500, targetUsd: 2000, dailyMaxUsd: 10_000, assets: ['USDC', 'ZARP', 'OUSD'] });
  });
  it('needs the payout wallet (a live signer) and an operating-wallet key', () => {
    expect(() => resolveTreasuryConfig(ok, undefined)).toThrow(/live payout signer/);
    expect(() => resolveTreasuryConfig({ TREASURY_MANAGER_ENABLED: 'true' }, payout)).toThrow(/no operating-wallet key/);
    expect(() => resolveTreasuryConfig({ ...ok, TREASURY_WARM_PRIVATE_KEY: 'nope' }, payout)).toThrow(/not a valid private key/);
  });
  it('refuses the same key for both tiers: then they protect nothing', () => {
    const w = new ethers.Wallet(warmKey);
    expect(() => resolveTreasuryConfig(ok, w.address)).toThrow(/same key/);
  });
  it('refuses thresholds that cannot work', () => {
    expect(() => resolveTreasuryConfig({ ...ok, REPLENISH_LOW_USD: '500', REPLENISH_TARGET_USD: '500' }, payout)).toThrow(/above/);
    expect(() => resolveTreasuryConfig({ ...ok, TREASURY_WARM_MAX_USD: '100', TREASURY_WARM_TARGET_USD: '200' }, payout)).toThrow(/below/);
    expect(() => resolveTreasuryConfig({ ...ok, REPLENISH_DAILY_MAX_USD: '-1' }, payout)).toThrow(/non-negative/);
  });
  it('validates the cold address and keeps it distinct from the hot wallets', () => {
    const cold = ethers.Wallet.createRandom().address;
    expect(resolveTreasuryConfig({ ...ok, TREASURY_COLD_ADDRESS: cold }, payout).cold).toBe(cold);
    expect(() => resolveTreasuryConfig({ ...ok, TREASURY_COLD_ADDRESS: 'nope' }, payout)).toThrow(TreasuryConfigError);
    expect(() => resolveTreasuryConfig({ ...ok, TREASURY_COLD_ADDRESS: payout }, payout)).toThrow(/different/);
    expect(() => resolveTreasuryConfig({ ...ok, TREASURY_COLD_ADDRESS: '0x0000000000000000000000000000000000000000' }, payout)).toThrow(/usable/);
  });
  it('refuses a development chain-id override in production', () => {
    expect(() => resolveTreasuryConfig({ ...ok, NODE_ENV: 'production', TREASURY_CHAIN_ID: '1337' }, payout)).toThrow(/production/);
  });
  it('a bad key never appears in the error', () => {
    try { resolveTreasuryConfig({ ...ok, TREASURY_WARM_PRIVATE_KEY: 'very-secret-but-wrong' }, payout); } catch (e) { expect((e as Error).message).not.toContain('very-secret'); }
  });
});

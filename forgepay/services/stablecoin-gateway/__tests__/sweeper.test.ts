import { describe, it, expect } from 'vitest';
import { gasDripWei, worthSweeping, resolveSweepConfig, SweepConfigError, sweepRequested } from '../src/lib/sweeper.js';
import { ethers } from 'ethers';

const KEY = ethers.Wallet.createRandom().privateKey;
const TREASURY = '0x49ddddb2987a27e2de4ba26bd57e646caf8c548c';
const ok = { SWEEP_ENABLED: 'true', SWEEP_TREASURY_ADDRESS: TREASURY, SWEEP_GAS_PRIVATE_KEY: KEY } as NodeJS.ProcessEnv;

describe('gas for a sweep', () => {
  it('tops an address up to what its sweep needs, plus the margin, and no more', () => {
    // 65,000 gas at 2 gwei = 130,000 gwei; +20% = 156,000 gwei
    expect(gasDripWei(65_000n, 2_000_000_000n, 20, 0n)).toBe(156_000n * 10n ** 9n);
    expect(gasDripWei(65_000n, 2_000_000_000n, 20, 100_000n * 10n ** 9n)).toBe(56_000n * 10n ** 9n);
  });
  it('sends nothing when the address already holds enough', () => {
    expect(gasDripWei(65_000n, 2_000_000_000n, 20, 10n ** 18n)).toBe(0n);
  });
  it('a dollar threshold decides what is worth the gas', () => {
    expect(worthSweeping(0.5, 1)).toBe(false);
    expect(worthSweeping(1, 1)).toBe(true);
    expect(worthSweeping(25, 1)).toBe(true);
  });
});

describe('sweeper configuration fails closed', () => {
  it('is off unless asked for', () => { expect(sweepRequested({})).toBe(false); expect(sweepRequested(ok)).toBe(true); });

  it('accepts a complete configuration and checksums the treasury', () => {
    const c = resolveSweepConfig(ok);
    expect(c.treasury('base')).toBe(ethers.getAddress(TREASURY));
    expect(c.minUsd).toBe(1);
    expect(c.maxGasGwei).toBe(50);
  });

  it('a per-chain treasury overrides the default', () => {
    const other = ethers.Wallet.createRandom().address;
    const c = resolveSweepConfig({ ...ok, SWEEP_TREASURY_ADDRESS_POLYGON: other });
    expect(c.treasury('polygon')).toBe(other);
    expect(c.treasury('base')).toBe(ethers.getAddress(TREASURY));
  });

  it('refuses without a treasury, a gas key, or with unusable values', () => {
    expect(() => resolveSweepConfig({ SWEEP_ENABLED: 'true', SWEEP_GAS_PRIVATE_KEY: KEY })).toThrow(/no treasury/);
    expect(() => resolveSweepConfig({ SWEEP_ENABLED: 'true', SWEEP_TREASURY_ADDRESS: TREASURY })).toThrow(/no gas wallet key/);
    expect(() => resolveSweepConfig({ ...ok, SWEEP_TREASURY_ADDRESS: '0x0000000000000000000000000000000000000000' })).toThrow(SweepConfigError);
    expect(() => resolveSweepConfig({ ...ok, SWEEP_TREASURY_ADDRESS: 'nope' })).toThrow(SweepConfigError);
    expect(() => resolveSweepConfig({ ...ok, SWEEP_GAS_PRIVATE_KEY: 'not a key' })).toThrow(/not a valid private key/);
    expect(() => resolveSweepConfig({ ...ok, SWEEP_MAX_GAS_GWEI: '-1' })).toThrow(/non-negative/);
  });

  it('a bad key never appears in the error', () => {
    try { resolveSweepConfig({ ...ok, SWEEP_GAS_PRIVATE_KEY: 'super-secret-but-invalid' }); } catch (e) { expect(String((e as Error).message)).not.toContain('super-secret'); }
  });

  it('refuses a development chain-id override in production', () => {
    expect(() => resolveSweepConfig({ ...ok, NODE_ENV: 'production', SWEEP_CHAIN_ID_BASE: '1337' })).toThrow(/production/);
    expect(resolveSweepConfig({ ...ok, SWEEP_CHAIN_ID_BASE: '1337' }).chainId('base')).toBe(1337);
  });
});

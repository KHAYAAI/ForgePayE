/**
 * yield-engine must not choose vaults on made-up numbers, deposit money it
 * cannot withdraw, or record moves that never happened.
 *
 * Regressions guarded: seed APYs were stamped "updated now" and drove vault
 * selection; deposits went on-chain while withdrawals could never execute;
 * Ondo deposits returned an invented "0xoffchain_…" hash; a merchant's manual
 * sweep ran every merchant's sweep.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../adapters', () => ({ getAdapter: vi.fn() }));
vi.mock('../config', () => ({
  config: {
    apyCacheTtlMs: 15 * 60 * 1000, ondoApiBase: 'https://example.invalid', ondoApiKey: '',
    rpc: { ethereum: 'http://localhost:8545', polygon: 'http://localhost:8546', base: 'http://localhost:8547', arbitrum: 'http://localhost:8548' },
    stablecoinGatewayUrl: 'http://localhost:3002', sweepIntervalMinutes: 15, corsOrigins: [], signerPrivateKey: '', jwtSecret: 'test', port: 3007,
  },
}));

import { getAdapter } from '../adapters';
import { getBestVault, invalidateApyCache } from '../services/apyAggregator';
import { onChainDepositsAllowed } from '../services/sweepService';
import { vaultsStore } from '../store';
import { OndoAdapter, OndoNotIntegratedError } from '../adapters/ondo';

describe('seed APYs', () => {
  beforeEach(() => invalidateApyCache());

  it('are labelled seed with no update time', () => {
    for (const v of vaultsStore.values()) {
      if (v.apySource === 'seed') expect(v.apyUpdatedAt).toBeNull();
    }
    expect([...vaultsStore.values()].every((v) => v.tvlSource === 'seed')).toBe(true);
  });

  it('never choose a vault: with every live read failing there is no best vault', async () => {
    for (const [id, v] of vaultsStore) vaultsStore.set(id, { ...v, apySource: 'seed', apyUpdatedAt: null });
    (getAdapter as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      protocol: 'aave_v3', getCurrentApy: vi.fn().mockRejectedValue(new Error('RPC down')), getBalance: vi.fn(),
    }));
    expect(await getBestVault('USDC')).toBeNull();
  });

  it('a live read makes a vault eligible and is labelled live', async () => {
    (getAdapter as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      protocol: 'aave_v3', getCurrentApy: vi.fn().mockResolvedValue(0.031), getBalance: vi.fn(),
    }));
    const best = await getBestVault('USDC');
    expect(best?.apySource).toBe('live');
    expect(best?.apyUpdatedAt).not.toBeNull();
  });
});

describe('on-chain deposits', () => {
  it('are never allowed in production, and only by explicit opt-in elsewhere', () => {
    expect(onChainDepositsAllowed({ NODE_ENV: 'production', YIELD_ONCHAIN_DEPOSITS: 'true' } as NodeJS.ProcessEnv)).toBe(false);
    expect(onChainDepositsAllowed({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
    expect(onChainDepositsAllowed({ NODE_ENV: 'development', YIELD_ONCHAIN_DEPOSITS: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('Ondo adapter', () => {
  it('refuses every operation instead of calling an unconfirmed API', async () => {
    const a = new OndoAdapter({} as never, 'ethereum' as never);
    await expect(a.getCurrentApy()).rejects.toBeInstanceOf(OndoNotIntegratedError);
    await expect(a.getBalance('0x0')).rejects.toBeInstanceOf(OndoNotIntegratedError);
    await expect(a.deposit({ walletAddress: '0x0', amountUsd: 1, paymentMethod: 'usdc' })).rejects.toBeInstanceOf(OndoNotIntegratedError);
    await expect(a.redeem({ walletAddress: '0x0', amountUsdy: 1, settlementRail: 'usdc' })).rejects.toBeInstanceOf(OndoNotIntegratedError);
  });
});

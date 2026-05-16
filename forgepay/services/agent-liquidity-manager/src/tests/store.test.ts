import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerWallet,
  updateWalletAssets,
  getWalletsForAgent,
  setPolicy,
  getPolicy,
  setTarget,
  getTarget,
  appendHistory,
  getHistory,
  _resetStoreForTests,
} from '../store';

describe('store', () => {
  beforeEach(() => {
    _resetStoreForTests();
  });

  it('registers and retrieves wallets per agent', () => {
    const w1 = registerWallet('a1', 'ethereum', '0x1', [
      { asset: 'USDC', balanceNative: 100, balanceUsd: 0, chain: 'ethereum' },
    ]);
    const w2 = registerWallet('a1', 'base', '0x2', []);
    registerWallet('a2', 'ethereum', '0x3', []);

    const a1Wallets = getWalletsForAgent('a1');
    expect(a1Wallets.map(w => w.walletId).sort()).toEqual([w1.walletId, w2.walletId].sort());
    expect(getWalletsForAgent('a2')).toHaveLength(1);
    // balanceUsd recomputed from rate table (USDC=1)
    expect(a1Wallets.find(w => w.walletId === w1.walletId)!.assets[0]!.balanceUsd).toBe(100);
  });

  it('updates wallet asset balances and refreshes timestamp', async () => {
    const w = registerWallet('a1', 'ethereum', '0x1', []);
    const original = w.updatedAt;
    await new Promise(r => setTimeout(r, 5));
    const updated = updateWalletAssets(w.walletId, [
      { asset: 'ETH', balanceNative: 2, balanceUsd: 0, chain: 'ethereum' },
    ]);
    expect(updated).not.toBeNull();
    expect(updated!.assets[0]!.balanceUsd).toBe(6_400);
    expect(updated!.updatedAt).not.toBe(original);
  });

  it('returns null when updating an unknown wallet', () => {
    expect(updateWalletAssets('w_missing', [])).toBeNull();
  });

  it('round-trips policies and targets', () => {
    setPolicy({
      agentId:               'a1',
      minLiquidStableUsd:    500,
      maxIdleStableUsd:      1_000,
      sweepVault:            'aave',
      autoLiquidateBelowUsd: 250,
      allowedAssets:         ['USDC'],
    });
    expect(getPolicy('a1')!.sweepVault).toBe('aave');
    expect(getPolicy('missing')).toBeNull();

    setTarget({ agentId: 'a1', stables: 0.6, treasuries: 0.2, eth: 0.2, btc: 0 });
    expect(getTarget('a1')!.stables).toBe(0.6);
  });

  it('records history events and returns them in reverse-chronological order', () => {
    appendHistory('a1', 'sweep',     { amountUsd: 100 });
    appendHistory('a1', 'liquidate', { amountUsd: 50 });
    appendHistory('a2', 'rebalance', { actions: [] });

    const a1 = getHistory('a1');
    expect(a1).toHaveLength(2);
    expect(a1[0]!.type).toBe('liquidate');  // most recent first
    expect(a1[1]!.type).toBe('sweep');
    expect(getHistory('a2')).toHaveLength(1);
  });
});

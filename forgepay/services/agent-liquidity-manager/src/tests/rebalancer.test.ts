import { describe, it, expect } from 'vitest';
import {
  computeRebalance,
  getAssetClass,
  snapshotAllocation,
  toUsd,
  validateTargetSum,
  DRIFT_THRESHOLD,
} from '../rebalancer';
import type { AgentWallet, PortfolioTarget } from '../types';

function makeWallet(assets: { asset: string; balanceNative: number; chain?: string }[]): AgentWallet {
  return {
    walletId:  'w_test',
    agentId:   'a_test',
    chain:     assets[0]?.chain ?? 'ethereum',
    address:   '0xabc',
    assets:    assets.map(a => ({
      asset:         a.asset,
      balanceNative: a.balanceNative,
      balanceUsd:    toUsd(a.balanceNative, a.asset),
      chain:         a.chain ?? 'ethereum',
    })),
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function target(t: Partial<PortfolioTarget>): PortfolioTarget {
  return {
    agentId:    'a_test',
    stables:    t.stables    ?? 0,
    treasuries: t.treasuries ?? 0,
    eth:        t.eth        ?? 0,
    btc:        t.btc        ?? 0,
    other:      t.other      ?? 0,
    updatedAt:  '2026-01-01T00:00:00Z',
  };
}

describe('asset class mapping', () => {
  it('maps stables / treasuries / eth / btc correctly', () => {
    expect(getAssetClass('USDC')).toBe('stables');
    expect(getAssetClass('USDT')).toBe('stables');
    expect(getAssetClass('USDY')).toBe('treasuries');
    expect(getAssetClass('TBILL')).toBe('treasuries');
    expect(getAssetClass('ETH')).toBe('eth');
    expect(getAssetClass('WETH')).toBe('eth');
    expect(getAssetClass('BTC')).toBe('btc');
    expect(getAssetClass('UNKNOWN_TOKEN')).toBe('other');
  });
});

describe('validateTargetSum', () => {
  it('accepts targets summing to 1.0', () => {
    expect(validateTargetSum({ stables: 0.5, treasuries: 0.3, eth: 0.2, btc: 0 })).toBe(true);
  });

  it('rejects targets that drift outside 0.001 tolerance', () => {
    expect(validateTargetSum({ stables: 0.5, treasuries: 0.3, eth: 0.1, btc: 0 })).toBe(false);
  });

  it('accepts sub-tolerance floating-point drift', () => {
    expect(validateTargetSum({ stables: 0.3333, treasuries: 0.3333, eth: 0.3334, btc: 0 })).toBe(true);
  });
});

describe('snapshotAllocation', () => {
  it('aggregates wallet assets into class buckets', () => {
    const w = makeWallet([
      { asset: 'USDC', balanceNative: 5000 },
      { asset: 'ETH',  balanceNative: 1 },     // $3200
    ]);
    const snap = snapshotAllocation(w);
    expect(snap.totalUsd).toBeCloseTo(8200);
    expect(snap.byClass.stables).toBeCloseTo(5000);
    expect(snap.byClass.eth).toBeCloseTo(3200);
    expect(snap.pctByClass.stables).toBeCloseTo(5000 / 8200);
  });

  it('returns zeros for empty wallet', () => {
    const w = makeWallet([]);
    const snap = snapshotAllocation(w);
    expect(snap.totalUsd).toBe(0);
    expect(snap.pctByClass.stables).toBe(0);
  });
});

describe('computeRebalance', () => {
  it('returns empty actions when drift is below threshold', () => {
    // 50% stables, 50% eth — target is 50/50 exactly → no action
    const w = makeWallet([
      { asset: 'USDC', balanceNative: 3200 },
      { asset: 'ETH',  balanceNative: 1 },
    ]);
    const t = target({ stables: 0.5, eth: 0.5 });
    expect(computeRebalance(w, t)).toEqual([]);
  });

  it('returns empty actions on exact-target portfolio', () => {
    const w = makeWallet([
      { asset: 'USDC', balanceNative: 1000 },
    ]);
    const t = target({ stables: 1.0 });
    expect(computeRebalance(w, t)).toEqual([]);
  });

  it('emits sell-from-overallocated-class action', () => {
    // 100% stables, target 50/50 stables/eth
    const w = makeWallet([{ asset: 'USDC', balanceNative: 10_000 }]);
    const t = target({ stables: 0.5, eth: 0.5 });
    const actions = computeRebalance(w, t);
    expect(actions.length).toBe(1);
    expect(actions[0]!.fromAsset).toBe('stables');
    expect(actions[0]!.toAsset).toBe('eth');
    expect(actions[0]!.amountUsd).toBeCloseTo(5_000);
  });

  it('handles single-asset portfolio rebalanced into multiple classes', () => {
    const w = makeWallet([{ asset: 'USDC', balanceNative: 10_000 }]);
    const t = target({ stables: 0.4, treasuries: 0.3, eth: 0.2, btc: 0.1 });
    const actions = computeRebalance(w, t);
    // Should emit one sell from stables matched to 3 different buyers
    const totalMoved = actions.reduce((s, a) => s + a.amountUsd, 0);
    expect(totalMoved).toBeCloseTo(6_000, 0);
    for (const a of actions) {
      expect(a.fromAsset).toBe('stables');
    }
    expect(actions.map(a => a.toAsset).sort()).toEqual(['btc', 'eth', 'treasuries']);
  });

  it('matches one seller class to one buyer class', () => {
    // Stables over-allocated, treasuries under-allocated
    const w = makeWallet([
      { asset: 'USDC', balanceNative: 8_000 },
      { asset: 'USDY', balanceNative: 2_000 },
    ]);
    const t = target({ stables: 0.5, treasuries: 0.5 });
    const actions = computeRebalance(w, t);
    expect(actions.length).toBe(1);
    expect(actions[0]!.fromAsset).toBe('stables');
    expect(actions[0]!.toAsset).toBe('treasuries');
    expect(actions[0]!.amountUsd).toBeCloseTo(3_000);
  });

  it('returns empty when totalUsd is zero', () => {
    const w = makeWallet([]);
    const t = target({ stables: 1.0 });
    expect(computeRebalance(w, t)).toEqual([]);
  });

  it('respects the drift threshold', () => {
    // 51 / 49 split where target is 50/50 — drift is 1% per class, total/2 = 1% < 2% threshold
    expect(DRIFT_THRESHOLD).toBe(0.02);
    const w = makeWallet([
      { asset: 'USDC', balanceNative: 5_100 },
      { asset: 'USDY', balanceNative: 4_900 },
    ]);
    const t = target({ stables: 0.5, treasuries: 0.5 });
    expect(computeRebalance(w, t)).toEqual([]);
  });

  it('emits actions when drift just exceeds the threshold', () => {
    // 53 / 47 → drift 3% > 2% threshold
    const w = makeWallet([
      { asset: 'USDC', balanceNative: 5_300 },
      { asset: 'USDY', balanceNative: 4_700 },
    ]);
    const t = target({ stables: 0.5, treasuries: 0.5 });
    const actions = computeRebalance(w, t);
    expect(actions.length).toBe(1);
    expect(actions[0]!.amountUsd).toBeCloseTo(300);
  });
});

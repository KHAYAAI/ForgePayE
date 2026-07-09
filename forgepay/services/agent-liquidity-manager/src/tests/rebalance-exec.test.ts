import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerWallet,
  getWalletsForAgent,
  executeRebalanceLeg,
  executeRebalancePlan,
  debitAssetClassAcrossWallets,
  creditAssetToAgent,
  _resetStoreForTests,
} from '../store';
import { computeRebalance } from '../rebalancer';
import type { PortfolioTarget, RebalanceAction } from '../types';

function walletsUsd(agentId: string) {
  return getWalletsForAgent(agentId).flatMap(w => w.assets.map(a => ({ asset: a.asset, usd: a.balanceUsd })));
}

describe('executeRebalanceLeg / executeRebalancePlan', () => {
  beforeEach(() => {
    _resetStoreForTests();
  });

  it('mutates real tracked balances: debits the source class, credits the destination class', () => {
    registerWallet('a1', 'ethereum', '0x1', [
      { asset: 'USDC', balanceNative: 1_000, balanceUsd: 0, chain: 'ethereum' },
    ]);

    const action: RebalanceAction = { fromAsset: 'stables', toAsset: 'eth', amountUsd: 400, reason: 'test' };
    const result = executeRebalanceLeg('a1', action);

    expect(result.status).toBe('executed');
    const assets = walletsUsd('a1');
    const usdc = assets.find(a => a.asset === 'USDC')!;
    const eth = assets.find(a => a.asset === 'ETH');
    expect(usdc.usd).toBeCloseTo(600, 2);
    expect(eth).toBeDefined();
    expect(eth!.usd).toBeCloseTo(400, 2);
  });

  it('leaves balances untouched when execute is not requested (dry-run/plan-only)', () => {
    registerWallet('a1', 'ethereum', '0x1', [
      { asset: 'USDC', balanceNative: 1_000, balanceUsd: 0, chain: 'ethereum' },
    ]);
    // Merely computing a plan (as the route does when execute!=='true') must
    // not touch any tracked balance — only executeRebalanceLeg/Plan does.
    const target: PortfolioTarget = { agentId: 'a1', stables: 0.5, treasuries: 0, eth: 0.5, btc: 0, updatedAt: '' };
    computeRebalance(getWalletsForAgent('a1'), target);

    const usdc = walletsUsd('a1').find(a => a.asset === 'USDC')!;
    expect(usdc.usd).toBe(1_000);
  });

  it('fails a leg cleanly on insufficient balance without throwing', () => {
    registerWallet('a1', 'ethereum', '0x1', [
      { asset: 'USDC', balanceNative: 100, balanceUsd: 0, chain: 'ethereum' },
    ]);
    const action: RebalanceAction = { fromAsset: 'stables', toAsset: 'eth', amountUsd: 5_000, reason: 'test' };
    const result = executeRebalanceLeg('a1', action);

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Insufficient balance/);
    // Nothing should have moved.
    expect(walletsUsd('a1').find(a => a.asset === 'USDC')!.usd).toBe(100);
  });

  it('a failed leg does not roll back sibling legs that already committed', () => {
    registerWallet('a1', 'ethereum', '0x1', [
      { asset: 'USDC', balanceNative: 1_000, balanceUsd: 0, chain: 'ethereum' },
    ]);

    const actions: RebalanceAction[] = [
      { fromAsset: 'stables', toAsset: 'eth', amountUsd: 300, reason: 'ok leg' },
      { fromAsset: 'stables', toAsset: 'btc', amountUsd: 5_000, reason: 'will fail — insufficient remaining balance' },
    ];
    const results = executeRebalancePlan('a1', actions);

    expect(results[0]!.status).toBe('executed');
    expect(results[1]!.status).toBe('failed');

    const assets = walletsUsd('a1');
    // The first leg's effect (300 USDC -> ETH) must still be committed even
    // though the second leg in the same batch failed.
    expect(assets.find(a => a.asset === 'ETH')!.usd).toBeCloseTo(300, 2);
    expect(assets.find(a => a.asset === 'USDC')!.usd).toBeCloseTo(700, 2);
  });

  it('is naturally idempotent: re-running computeRebalance after execution finds zero drift', () => {
    registerWallet('a1', 'ethereum', '0x1', [
      { asset: 'USDC', balanceNative: 1_000, balanceUsd: 0, chain: 'ethereum' },
    ]);
    const target: PortfolioTarget = { agentId: 'a1', stables: 0.5, treasuries: 0, eth: 0.5, btc: 0, updatedAt: '' };

    const firstPlan = computeRebalance(getWalletsForAgent('a1'), target);
    expect(firstPlan.length).toBeGreaterThan(0);
    executeRebalancePlan('a1', firstPlan);

    // Re-reading current (now-updated) wallet state should show the drift
    // already closed — a second execute of the same target computes no
    // further legs, so calling /rebalance?execute=true twice in a row
    // can't double-move funds.
    const secondPlan = computeRebalance(getWalletsForAgent('a1'), target);
    expect(secondPlan).toHaveLength(0);
  });
});

describe('debitAssetClassAcrossWallets / creditAssetToAgent (sweep/liquidate wiring)', () => {
  beforeEach(() => {
    _resetStoreForTests();
  });

  it('debits stables across wallets up to the requested amount', () => {
    registerWallet('a1', 'ethereum', '0x1', [
      { asset: 'USDC', balanceNative: 500, balanceUsd: 0, chain: 'ethereum' },
    ]);
    const debited = debitAssetClassAcrossWallets('a1', 'stables', 200);
    expect(debited).toBeCloseTo(200, 2);
    expect(walletsUsd('a1').find(a => a.asset === 'USDC')!.usd).toBeCloseTo(300, 2);
  });

  it('never debits more than is actually available', () => {
    registerWallet('a1', 'ethereum', '0x1', [
      { asset: 'USDC', balanceNative: 50, balanceUsd: 0, chain: 'ethereum' },
    ]);
    const debited = debitAssetClassAcrossWallets('a1', 'stables', 200);
    expect(debited).toBeCloseTo(50, 2);
    expect(walletsUsd('a1').find(a => a.asset === 'USDC')!.usd).toBeCloseTo(0, 2);
  });

  it('credits an asset back into the agent\'s first wallet', () => {
    registerWallet('a1', 'ethereum', '0x1', [
      { asset: 'USDC', balanceNative: 100, balanceUsd: 0, chain: 'ethereum' },
    ]);
    const credited = creditAssetToAgent('a1', 'USDC', 250);
    expect(credited).toBe(250);
    expect(walletsUsd('a1').find(a => a.asset === 'USDC')!.usd).toBeCloseTo(350, 2);
  });

  it('sweep-then-liquidate round trip restores the original balance (no double-count)', () => {
    registerWallet('a1', 'ethereum', '0x1', [
      { asset: 'USDC', balanceNative: 1_000, balanceUsd: 0, chain: 'ethereum' },
    ]);
    debitAssetClassAcrossWallets('a1', 'stables', 400); // simulates a successful sweep
    expect(walletsUsd('a1').find(a => a.asset === 'USDC')!.usd).toBeCloseTo(600, 2);

    creditAssetToAgent('a1', 'USDC', 400); // simulates a successful liquidate of the same amount
    expect(walletsUsd('a1').find(a => a.asset === 'USDC')!.usd).toBeCloseTo(1_000, 2);
  });
});

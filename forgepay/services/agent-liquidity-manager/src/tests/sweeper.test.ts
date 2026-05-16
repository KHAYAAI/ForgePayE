import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeIdleStableUsd,
  computeLiquidStableUsd,
  sweepToYield,
  liquidateFromYield,
} from '../sweeper';
import type { AgentWallet, LiquidityPolicy } from '../types';
import { toUsd } from '../rebalancer';

function makeWallet(assets: { asset: string; balanceNative: number }[]): AgentWallet {
  return {
    walletId:  'w_test',
    agentId:   'a_test',
    chain:     'ethereum',
    address:   '0xabc',
    assets:    assets.map(a => ({
      asset:         a.asset,
      balanceNative: a.balanceNative,
      balanceUsd:    toUsd(a.balanceNative, a.asset),
      chain:         'ethereum',
    })),
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function policy(p: Partial<LiquidityPolicy> = {}): LiquidityPolicy {
  return {
    agentId:               'a_test',
    minLiquidStableUsd:    p.minLiquidStableUsd    ?? 1_000,
    maxIdleStableUsd:      p.maxIdleStableUsd      ?? 1_000,
    sweepVault:            p.sweepVault            ?? 'aave',
    autoLiquidateBelowUsd: p.autoLiquidateBelowUsd ?? 500,
    allowedAssets:         p.allowedAssets         ?? ['USDC', 'USDT'],
    updatedAt:             '2026-01-01T00:00:00Z',
  };
}

describe('sweep/liquidate math', () => {
  it('computeLiquidStableUsd sums only stable assets', () => {
    const w = makeWallet([
      { asset: 'USDC', balanceNative: 5_000 },
      { asset: 'ETH',  balanceNative: 1 },
    ]);
    expect(computeLiquidStableUsd(w)).toBeCloseTo(5_000);
  });

  it('computeIdleStableUsd subtracts the liquidity floor', () => {
    const w = makeWallet([{ asset: 'USDC', balanceNative: 5_000 }]);
    expect(computeIdleStableUsd(w, policy({ minLiquidStableUsd: 1_000 }))).toBeCloseTo(4_000);
  });
});

describe('sweepToYield', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, txId: 'tx_1' }), { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips when idle balance is below the max-idle threshold', async () => {
    const w = makeWallet([{ asset: 'USDC', balanceNative: 1_500 }]);
    const res = await sweepToYield('a_test', policy({ minLiquidStableUsd: 1_000, maxIdleStableUsd: 1_000 }), w);
    expect(res.status).toBe('skipped');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sweeps when idle exceeds threshold and calls yield-engine', async () => {
    const w = makeWallet([{ asset: 'USDC', balanceNative: 10_000 }]);
    const res = await sweepToYield('a_test', policy({ minLiquidStableUsd: 1_000, maxIdleStableUsd: 1_000, sweepVault: 'ondo' }), w);
    expect(res.status).toBe('swept');
    expect(res.amountUsd).toBeCloseTo(9_000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain('/v1/sweep/trigger');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ agentId: 'a_test', vault: 'ondo', asset: 'USDC' });
    expect(body.amountUsd).toBeCloseTo(9_000);
  });

  it('marks as skipped on yield-engine failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const w = makeWallet([{ asset: 'USDC', balanceNative: 10_000 }]);
    const res = await sweepToYield('a_test', policy({ minLiquidStableUsd: 1_000, maxIdleStableUsd: 1_000 }), w);
    expect(res.status).toBe('skipped');
    expect(res.reason).toContain('yield-engine');
  });
});

describe('liquidateFromYield', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, withdrawn: 200 }), { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects a deficit and posts withdraw request', async () => {
    const w = makeWallet([{ asset: 'USDC', balanceNative: 300 }]);
    const res = await liquidateFromYield('a_test', policy({ autoLiquidateBelowUsd: 500 }), w);
    expect(res.status).toBe('liquidated');
    expect(res.amountUsd).toBeCloseTo(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain('/v1/sweep/withdraw');
  });

  it('skips when liquid balance is above floor', async () => {
    const w = makeWallet([{ asset: 'USDC', balanceNative: 800 }]);
    const res = await liquidateFromYield('a_test', policy({ autoLiquidateBelowUsd: 500 }), w);
    expect(res.status).toBe('skipped');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

/**
 * Rebalance Engine
 * ──────────────────────────────────────────────────────────────────────────────
 * Computes RebalanceAction[] that move a wallet from its current asset-class
 * allocation toward its PortfolioTarget. Skips trivial drifts under 2 %.
 */

import {
  AgentWallet,
  AssetBalance,
  AssetClass,
  PortfolioTarget,
  RebalanceAction,
} from './types';

// ── Asset class taxonomy ──────────────────────────────────────────────────────

export const ASSET_CLASS: Record<string, AssetClass> = {
  USDC:  'stables',
  USDT:  'stables',
  DAI:   'stables',
  USDY:  'treasuries',
  TBILL: 'treasuries',
  BUIDL: 'treasuries',
  ETH:   'eth',
  WETH:  'eth',
  BTC:   'btc',
  WBTC:  'btc',
};

export function getAssetClass(asset: string): AssetClass {
  return ASSET_CLASS[asset.toUpperCase()] ?? 'other';
}

// ── FX / USD conversion ───────────────────────────────────────────────────────

export const USD_RATES: Record<string, number> = {
  USDC:  1.0,
  USDT:  1.0,
  DAI:   1.0,
  USDY:  1.0,
  TBILL: 1.0,
  BUIDL: 1.0,
  ETH:   3200.0,
  WETH:  3200.0,
  BTC:   68000.0,
  WBTC:  68000.0,
};

export function toUsd(amount: number, asset: string): number {
  return amount * (USD_RATES[asset.toUpperCase()] ?? 0);
}

// ── Target validation ─────────────────────────────────────────────────────────

export const TARGET_SUM_TOLERANCE = 0.001;
export const DRIFT_THRESHOLD      = 0.02;

export function validateTargetSum(target: Pick<PortfolioTarget, 'stables' | 'treasuries' | 'eth' | 'btc' | 'other'>): boolean {
  const sum = target.stables + target.treasuries + target.eth + target.btc + (target.other ?? 0);
  return Math.abs(sum - 1.0) <= TARGET_SUM_TOLERANCE;
}

// ── Allocation snapshot ───────────────────────────────────────────────────────

export interface AllocationSnapshot {
  totalUsd: number;
  byClass:  Record<AssetClass, number>;       // USD per class
  pctByClass: Record<AssetClass, number>;     // 0-1 fraction
}

export function snapshotAllocation(wallets: AgentWallet[] | AgentWallet): AllocationSnapshot {
  const list = Array.isArray(wallets) ? wallets : [wallets];
  const byClass: Record<AssetClass, number> = {
    stables:    0,
    treasuries: 0,
    eth:        0,
    btc:        0,
    other:      0,
  };

  let totalUsd = 0;
  for (const w of list) {
    for (const a of w.assets) {
      const usd = a.balanceUsd > 0 ? a.balanceUsd : toUsd(a.balanceNative, a.asset);
      const cls = getAssetClass(a.asset);
      byClass[cls] += usd;
      totalUsd    += usd;
    }
  }

  const pctByClass: Record<AssetClass, number> = {
    stables:    0,
    treasuries: 0,
    eth:        0,
    btc:        0,
    other:      0,
  };
  if (totalUsd > 0) {
    for (const k of Object.keys(byClass) as AssetClass[]) {
      pctByClass[k] = byClass[k] / totalUsd;
    }
  }

  return { totalUsd, byClass, pctByClass };
}

// ── Core rebalance algorithm ──────────────────────────────────────────────────

export function computeRebalance(
  wallets: AgentWallet[] | AgentWallet,
  target: PortfolioTarget,
): RebalanceAction[] {
  const snap = snapshotAllocation(wallets);
  if (snap.totalUsd <= 0) return [];

  const targetByClass: Record<AssetClass, number> = {
    stables:    target.stables,
    treasuries: target.treasuries,
    eth:        target.eth,
    btc:        target.btc,
    other:      target.other ?? 0,
  };

  // Compute drift per class
  const drifts: { cls: AssetClass; deltaPct: number; deltaUsd: number }[] = [];
  let totalAbsDrift = 0;
  for (const cls of Object.keys(targetByClass) as AssetClass[]) {
    const deltaPct = snap.pctByClass[cls] - targetByClass[cls];     // >0 over-allocated
    const deltaUsd = deltaPct * snap.totalUsd;
    drifts.push({ cls, deltaPct, deltaUsd });
    totalAbsDrift += Math.abs(deltaPct);
  }

  // Use half of summed absolute drift (each $ shows up once as buy and once as sell)
  if (totalAbsDrift / 2 < DRIFT_THRESHOLD) return [];

  const sellers = drifts.filter(d => d.deltaUsd > 0).sort((a, b) => b.deltaUsd - a.deltaUsd);
  const buyers  = drifts.filter(d => d.deltaUsd < 0).sort((a, b) => a.deltaUsd - b.deltaUsd);

  const actions: RebalanceAction[] = [];
  let si = 0;
  let bi = 0;
  while (si < sellers.length && bi < buyers.length) {
    const s = sellers[si]!;
    const b = buyers[bi]!;
    const move = Math.min(s.deltaUsd, -b.deltaUsd);
    if (move > 0.01) {
      actions.push({
        fromAsset: s.cls,
        toAsset:   b.cls,
        amountUsd: round2(move),
        reason:    `Rebalance ${s.cls} → ${b.cls} (drift ${(s.deltaPct * 100).toFixed(2)}%)`,
      });
    }
    s.deltaUsd -= move;
    b.deltaUsd += move;
    if (s.deltaUsd <= 0.0001) si++;
    if (b.deltaUsd >= -0.0001) bi++;
  }

  return actions;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function recomputeWalletUsd(assets: AssetBalance[]): AssetBalance[] {
  return assets.map((a) => ({
    ...a,
    balanceUsd: toUsd(a.balanceNative, a.asset),
  }));
}

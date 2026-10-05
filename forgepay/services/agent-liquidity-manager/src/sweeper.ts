/**
 * Sweeper / Liquidator
 * ──────────────────────────────────────────────────────────────────────────────
 * Auto-deploys idle stablecoin balances to yield vaults and pulls back
 * liquidity when an agent dips below its safety floor.
 *
 * Not connected. These posted to yield-engine /v1/sweep/trigger and
 * /v1/sweep/withdraw, which do not exist (yield-engine's routes are under
 * /api/v1 and act only for a merchant's own JWT), and yield-engine cannot
 * execute withdrawals. Both now return 'not_supported' with the reason, and
 * nothing is debited or credited.
 */

import { AgentWallet, LiquidityPolicy } from './types';
import { getAssetClass, toUsd } from './rebalancer';

const DEFAULT_MAX_IDLE_USD     = 1_000;

export const YIELD_NOT_CONNECTED =
  'Not available: the liquidity manager is not connected to the yield engine, so it cannot sweep to or withdraw from yield.';

// ── Liquidity math ────────────────────────────────────────────────────────────

export function computeLiquidStableUsd(wallets: AgentWallet[] | AgentWallet): number {
  const list = Array.isArray(wallets) ? wallets : [wallets];
  let total = 0;
  for (const w of list) {
    for (const a of w.assets) {
      if (getAssetClass(a.asset) !== 'stables') continue;
      total += toUsd(a.balanceNative, a.asset);
    }
  }
  return total;
}

export function computeIdleStableUsd(
  wallets: AgentWallet[] | AgentWallet,
  policy: LiquidityPolicy,
): number {
  const liquid = computeLiquidStableUsd(wallets);
  return Math.max(0, liquid - policy.minLiquidStableUsd);
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

export interface SweepResult {
  status:      'swept' | 'skipped' | 'not_supported';
  amountUsd:   number;
  vault?:      string;
  reason?:     string;
  response?:   unknown;
}

export async function sweepToYield(
  agentId: string,
  policy: LiquidityPolicy,
  wallets: AgentWallet[] | AgentWallet,
): Promise<SweepResult> {
  const idleUsd  = computeIdleStableUsd(wallets, policy);
  const threshold = policy.maxIdleStableUsd > 0 ? policy.maxIdleStableUsd : DEFAULT_MAX_IDLE_USD;

  if (idleUsd <= threshold) {
    return {
      status:    'skipped',
      amountUsd: idleUsd,
      reason:    `idle ${idleUsd.toFixed(2)} USD below threshold ${threshold}`,
    };
  }

  void agentId;
  return {
    status:    'not_supported',
    amountUsd: idleUsd,
    reason:    YIELD_NOT_CONNECTED,
  };
}

// ── Liquidate ─────────────────────────────────────────────────────────────────

export interface LiquidateResult {
  status:    'liquidated' | 'skipped' | 'not_supported';
  amountUsd: number;
  reason?:   string;
  response?: unknown;
}

export async function liquidateFromYield(
  agentId: string,
  policy: LiquidityPolicy,
  wallets: AgentWallet[] | AgentWallet,
): Promise<LiquidateResult> {
  const liquid = computeLiquidStableUsd(wallets);

  if (liquid >= policy.autoLiquidateBelowUsd) {
    return {
      status:    'skipped',
      amountUsd: 0,
      reason:    `liquid ${liquid.toFixed(2)} USD above floor ${policy.autoLiquidateBelowUsd}`,
    };
  }

  const deficit = policy.autoLiquidateBelowUsd - liquid;
  void agentId;
  return {
    status:    'not_supported',
    amountUsd: deficit,
    reason:    YIELD_NOT_CONNECTED,
  };
}

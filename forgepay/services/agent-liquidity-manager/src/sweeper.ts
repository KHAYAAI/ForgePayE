/**
 * Sweeper / Liquidator
 * ──────────────────────────────────────────────────────────────────────────────
 * Auto-deploys idle stablecoin balances to yield vaults and pulls back
 * liquidity when an agent dips below its safety floor.
 *
 * Talks to the yield-engine over HTTP (POST /v1/sweep/trigger, /v1/sweep/withdraw).
 */

import { AgentWallet, LiquidityPolicy } from './types';
import { getAssetClass, toUsd } from './rebalancer';

const DEFAULT_YIELD_ENGINE_URL = 'http://localhost:3007';
const DEFAULT_MAX_IDLE_USD     = 1_000;

function yieldEngineUrl(): string {
  return process.env['YIELD_ENGINE_URL'] ?? DEFAULT_YIELD_ENGINE_URL;
}

// ── Liquidity math ────────────────────────────────────────────────────────────

export function computeLiquidStableUsd(wallets: AgentWallet[] | AgentWallet): number {
  const list = Array.isArray(wallets) ? wallets : [wallets];
  let total = 0;
  for (const w of list) {
    for (const a of w.assets) {
      if (getAssetClass(a.asset) !== 'stables') continue;
      total += a.balanceUsd > 0 ? a.balanceUsd : toUsd(a.balanceNative, a.asset);
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
  status:      'swept' | 'skipped';
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

  const body = {
    agentId,
    vault:     policy.sweepVault,
    amountUsd: idleUsd,
    asset:     'USDC',
  };

  let response: unknown = null;
  try {
    const resp = await fetch(`${yieldEngineUrl()}/v1/sweep/trigger`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-source': 'agent-liquidity-manager' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`yield-engine returned ${resp.status}`);
    response = await resp.json().catch(() => ({}));
  } catch (err) {
    return {
      status:    'skipped',
      amountUsd: idleUsd,
      reason:    `yield-engine unavailable: ${(err as Error).message}`,
    };
  }

  return {
    status:    'swept',
    amountUsd: idleUsd,
    vault:     policy.sweepVault,
    response,
  };
}

// ── Liquidate ─────────────────────────────────────────────────────────────────

export interface LiquidateResult {
  status:    'liquidated' | 'skipped';
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

  const body = { agentId, amountUsd: deficit };
  let response: unknown = null;
  try {
    const resp = await fetch(`${yieldEngineUrl()}/v1/sweep/withdraw`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-source': 'agent-liquidity-manager' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`yield-engine returned ${resp.status}`);
    response = await resp.json().catch(() => ({}));
  } catch (err) {
    return {
      status:    'skipped',
      amountUsd: deficit,
      reason:    `yield-engine unavailable: ${(err as Error).message}`,
    };
  }

  return {
    status:    'liquidated',
    amountUsd: deficit,
    response,
  };
}

/**
 * Position Tracker.
 *
 * Keeps YieldPosition records up to date by:
 *   1. Reading on-chain balances (via adapters) to compute currentValue.
 *   2. Calculating unrealizedYield = currentValue - principal.
 *   3. Building portfolio summaries for the dashboard.
 *
 * Called by the 15-minute cron job as well as on-demand by the positions API.
 *
 * PROD NOTE: On-chain reads are batched via multicall where possible.
 *            Position records live in PostgreSQL; the in-memory store here
 *            is for development only.
 */

import pino from 'pino';
import { getAdapter } from '../adapters';
import { positionsStore, vaultsStore } from '../store';
import type { YieldPosition, PortfolioSummary, VaultAllocation, ChainName } from '../types';

const logger = pino({ name: 'position-tracker' });

// ── On-chain balance fetch ────────────────────────────────────────────────────

/**
 * Fetch the current on-chain balance for a position's vault and update the
 * position record in place.
 *
 * Returns the updated position, or the original if the on-chain call fails.
 */
async function refreshPositionFromChain(position: YieldPosition): Promise<YieldPosition> {
  const vault = vaultsStore.get(position.vaultId);
  if (!vault) {
    logger.warn({ positionId: position.id }, 'Vault not found; skipping refresh');
    return position;
  }

  // For the position we need the merchant's on-chain wallet address.
  // PROD: look up the hot-wallet address from PostgreSQL / Vault.
  // Here we use a placeholder; real deployments pass the actual address.
  const walletAddress: string | undefined = (position as YieldPosition & { walletAddress?: string }).walletAddress;
  if (!walletAddress) {
    // Cannot refresh without a wallet address; skip silently
    return position;
  }

  try {
    const adapter      = getAdapter(vault.protocol, vault.chain as ChainName);
    const currentValue = await adapter.getBalance(walletAddress);
    const unrealizedYield = Math.max(0, currentValue - position.principal);

    const updated: YieldPosition = {
      ...position,
      currentValue,
      unrealizedYield,
      lastUpdatedAt: new Date().toISOString(),
    };
    positionsStore.set(position.id, updated);
    return updated;
  } catch (err) {
    logger.warn({ positionId: position.id, err }, 'On-chain balance fetch failed');
    return position;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Refresh every active position from chain.
 * Called by the 15-minute cron job.
 */
export async function updateAllPositions(): Promise<void> {
  const activePositions = [...positionsStore.values()].filter(
    (p) => p.status === 'active',
  );

  if (activePositions.length === 0) return;

  logger.info({ count: activePositions.length }, 'Refreshing positions from chain');

  const results = await Promise.allSettled(
    activePositions.map(refreshPositionFromChain),
  );

  const errors = results.filter((r) => r.status === 'rejected');
  if (errors.length > 0) {
    logger.warn({ errorCount: errors.length }, 'Some positions failed to refresh');
  }

  logger.info({ count: activePositions.length - errors.length }, 'Positions refreshed');
}

/**
 * Build a portfolio summary for a single merchant.
 *
 * Aggregates across all their active positions:
 *   - total principal, current value, unrealized yield, realized yield
 *   - weighted-average APY (weighted by current value)
 *   - per-vault breakdown
 */
export function getPortfolioSummary(merchantId: string): PortfolioSummary {
  const positions = [...positionsStore.values()].filter(
    (p) => p.merchantId === merchantId && p.status !== 'closed',
  );

  let totalPrincipal       = 0;
  let totalCurrentValue    = 0;
  let totalUnrealizedYield = 0;
  let totalRealizedYield   = 0;
  let weightedApyNum       = 0; // numerator for weighted average
  const allocations: VaultAllocation[] = [];

  for (const pos of positions) {
    const vault = vaultsStore.get(pos.vaultId);
    const apy   = vault?.apy ?? 0;

    totalPrincipal       += pos.principal;
    totalCurrentValue    += pos.currentValue;
    totalUnrealizedYield += pos.unrealizedYield;
    totalRealizedYield   += pos.realizedYield;
    weightedApyNum       += pos.currentValue * apy;

    allocations.push({
      vaultId:         pos.vaultId,
      vaultName:       vault?.name ?? pos.vaultId,
      protocol:        vault?.protocol ?? 'manual',
      principal:       pos.principal,
      currentValue:    pos.currentValue,
      unrealizedYield: pos.unrealizedYield,
      apy,
    });
  }

  // Also sum realized yield from closed positions
  const closedPositions = [...positionsStore.values()].filter(
    (p) => p.merchantId === merchantId && p.status === 'closed',
  );
  for (const pos of closedPositions) {
    totalRealizedYield += pos.realizedYield;
  }

  const weightedApy = totalCurrentValue > 0
    ? weightedApyNum / totalCurrentValue
    : 0;

  return {
    merchantId,
    totalPrincipal,
    totalCurrentValue,
    totalUnrealizedYield,
    totalRealizedYield,
    weightedApy,
    allocations,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Refresh a single position and return the updated record.
 * Used by the positions API for on-demand refresh.
 */
export async function refreshPosition(positionId: string): Promise<YieldPosition | null> {
  const position = positionsStore.get(positionId);
  if (!position) return null;
  return refreshPositionFromChain(position);
}

/**
 * Mark a position as 'withdrawing' and record the realized yield.
 * Called by the sweep service when initiating a withdrawal.
 */
export function initiateWithdrawal(positionId: string): YieldPosition | null {
  const position = positionsStore.get(positionId);
  if (!position || position.status !== 'active') return null;

  const updated: YieldPosition = {
    ...position,
    status:        'withdrawing',
    realizedYield: position.realizedYield + position.unrealizedYield,
    lastUpdatedAt: new Date().toISOString(),
  };
  positionsStore.set(positionId, updated);
  return updated;
}

/**
 * Close a position after a successful on-chain withdrawal.
 */
export function closePosition(positionId: string): YieldPosition | null {
  const position = positionsStore.get(positionId);
  if (!position) return null;

  const updated: YieldPosition = {
    ...position,
    status:        'closed',
    currentValue:  0,
    shares:        0,
    lastUpdatedAt: new Date().toISOString(),
  };
  positionsStore.set(positionId, updated);
  return updated;
}

/**
 * APY Aggregator.
 *
 * Responsible for:
 *   1. Fetching current APYs from every configured vault in parallel.
 *   2. Caching results for `APY_CACHE_TTL_MS` (default: 15 min).
 *   3. Selecting the best vault for a given asset / risk criteria.
 *
 * PROD NOTE: The in-memory cache should be replaced with Redis (SETEX) so
 * multiple pod replicas share a single source of truth and a crash doesn't
 * force an immediate re-fetch of all on-chain data.
 */

import pino from 'pino';
import { getAdapter } from '../adapters';
import { vaultsStore } from '../store';
import { config } from '../config';
import type { Protocol, AssetSymbol, YieldVault, ApyCacheEntry, ChainName } from '../types';

const logger = pino({ name: 'apy-aggregator' });

// ── In-memory APY cache ───────────────────────────────────────────────────────
// Key: vault ID  →  Value: { apy, fetchedAt }
// PROD: replace with Redis HSET yield:apys <vaultId> <json>
const apyCache = new Map<string, ApyCacheEntry>();

function isCacheValid(entry: ApyCacheEntry): boolean {
  return Date.now() - entry.fetchedAt < config.apyCacheTtlMs;
}

// ── Single-vault APY fetch ────────────────────────────────────────────────────

async function fetchApyForVault(vault: YieldVault): Promise<number> {
  const cached = apyCache.get(vault.id);
  if (cached && isCacheValid(cached)) {
    return cached.apy;
  }

  try {
    const adapter = getAdapter(vault.protocol, vault.chain as ChainName);
    const apy     = await adapter.getCurrentApy();

    apyCache.set(vault.id, { apy, fetchedAt: Date.now() });

    // Persist back into the vault store so /api/v1/vaults reflects live data
    const existing = vaultsStore.get(vault.id);
    if (existing) {
      vaultsStore.set(vault.id, {
        ...existing,
        apy,
        apyUpdatedAt: new Date().toISOString(),
      });
    }

    return apy;
  } catch (err) {
    logger.warn({ vaultId: vault.id, err }, 'Failed to fetch APY; using cached/seed value');
    // Return last known value so a single RPC failure doesn't break everything
    return vault.apy;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch (or return cached) APYs for every vault registered in the vault store.
 *
 * @returns Map from protocol name → APY decimal for the highest-APY vault of
 *          that protocol (useful for aggregate dashboards).
 */
export async function fetchAllApys(): Promise<Map<Protocol, number>> {
  const vaults  = [...vaultsStore.values()];
  const results = await Promise.allSettled(
    vaults.map((v) => fetchApyForVault(v).then((apy) => ({ protocol: v.protocol, apy }))),
  );

  const byProtocol = new Map<Protocol, number>();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { protocol, apy } = result.value;
      const existing = byProtocol.get(protocol) ?? -Infinity;
      if (apy > existing) {
        byProtocol.set(protocol, apy);
      }
    }
  }

  return byProtocol;
}

/**
 * Find the vault offering the highest APY for a given asset, subject to
 * optional filters.
 *
 * @param asset      The stablecoin symbol to search for.
 * @param minApy     Only consider vaults with APY ≥ minApy.
 * @param riskLevel  Only consider vaults at or below this risk level.
 * @param chains     Restrict to specific chains.
 */
export async function getBestVault(
  asset: AssetSymbol,
  minApy: number = 0,
  riskLevel: 'low' | 'medium' | 'high' = 'high',
  chains?: ChainName[],
): Promise<YieldVault | null> {
  const riskOrder: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const maxRiskIdx = riskOrder[riskLevel] ?? 2;

  const candidates = [...vaultsStore.values()].filter((v) => {
    if (v.asset !== asset) return false;
    if ((riskOrder[v.riskLevel] ?? 99) > maxRiskIdx) return false;
    if (chains && !chains.includes(v.chain as ChainName)) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  // Fetch fresh APYs for all candidates in parallel
  await Promise.allSettled(candidates.map(fetchApyForVault));

  // Re-read from vault store (which was updated by fetchApyForVault)
  const ranked = candidates
    .map((v) => vaultsStore.get(v.id) ?? v)
    .filter((v) => v.apy >= minApy)
    .sort((a, b) => b.apy - a.apy);

  return ranked[0] ?? null;
}

/**
 * Return the cached APY for a single vault.
 * Returns null if not yet fetched.
 */
export function getCachedApy(vaultId: string): number | null {
  const entry = apyCache.get(vaultId);
  return entry ? entry.apy : null;
}

/**
 * Force-invalidate the APY cache for all vaults (useful after config changes).
 */
export function invalidateApyCache(): void {
  apyCache.clear();
}

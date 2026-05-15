import { rwaAssets } from './store';

// ── NAV management ────────────────────────────────────────────────────────────

/**
 * Refresh NAVs for all assets.
 *
 * Stub implementation — logs intent and updates timestamps.
 *
 * In production this would:
 *   - On-chain assets (ethereum, polygon): call Chainlink price oracle
 *     via ethers.js JsonRpcProvider to get the latest NAV from the token contract
 *   - Off-chain / Stellar assets: call issuer REST API
 *     (e.g. Franklin Templeton's FOBXX API, OpenEden's data API)
 *   - Ondo products: query Ondo's public API (https://api.ondo.finance/v1)
 *   - BlackRock BUIDL: query Securitize investor portal API
 *   - Superstate USTB: query fund administrator API
 */
export function refreshAllNAVs(): void {
  const now = new Date().toISOString();

  console.log(
    '[rwa-registry] Would fetch NAVs from on-chain oracles / issuer APIs:',
  );

  for (const asset of rwaAssets.values()) {
    if (asset.chain && asset.contractAddress) {
      console.log(
        `  → ${asset.symbol} (${asset.chain}): Chainlink oracle / ERC-20 totalAssets() on ${asset.contractAddress}`,
      );
    } else {
      console.log(
        `  → ${asset.symbol}: Issuer API (${asset.issuer})`,
      );
    }

    // Update timestamp to signal a refresh was attempted
    asset.navUpdatedAt = now;
    asset.updatedAt = now;
  }

  console.log(`[rwa-registry] NAV refresh complete for ${rwaAssets.size} assets`);
}

/**
 * Returns all active RWA assets sorted by APY descending — useful for
 * yield comparison / recommendation engine.
 */
export function getYieldComparison(): Array<{
  assetId: string;
  name: string;
  symbol: string;
  apyBps: number;
  apyPercent: string;
  redemptionSpeed: string;
  minimumUsd: number;
  chain: string | undefined;
  issuer: string;
  requiresAccredited: boolean;
}> {
  return Array.from(rwaAssets.values())
    .filter(a => a.status === 'active')
    .sort((a, b) => b.currentApyBps - a.currentApyBps)
    .map(a => ({
      assetId: a.id,
      name: a.name,
      symbol: a.symbol,
      apyBps: a.currentApyBps,
      apyPercent: (a.currentApyBps / 100).toFixed(2) + '%',
      redemptionSpeed: a.redemptionSpeed,
      minimumUsd: a.minimumInvestmentUsd,
      chain: a.chain,
      issuer: a.issuer,
      requiresAccredited: a.requiresAccreditedInvestor,
    }));
}

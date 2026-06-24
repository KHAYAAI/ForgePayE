import { rwaAssets } from './store';
import { getCachedNAV, cacheNAV } from './db';

// ── CoinGecko API Integration ─────────────────────────────────────────────────

const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3/simple/price';

/**
 * Map RWA asset symbols to CoinGecko coin IDs.
 * Uses free tier — no authentication required.
 */
const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  USDY: 'ondo-governance-token',      // Ondo Finance
  FOBXX: 'franklin-templeton-onchain-fund', // Franklin OnChain
  TBILL: 'openedentoken',              // OpenEden T-Bill Vault
  BUIDL: 'blackrock-usd-institutional-digital-liquidity-fund', // BlackRock BUIDL
  OUSG: 'ondo-us-government-short-term-bond',  // Ondo Short-Term US Government
  USTB: 'superstate-ethereum-fund',   // Superstate USTB
};

/**
 * Fetch price from CoinGecko API for a given coin ID.
 */
async function fetchPriceFromCoinGecko(coinId: string): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      ids: coinId,
      vs_currencies: 'usd',
    });
    const url = `${COINGECKO_API_URL}?${params.toString()}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      timeout: 5000,
    } as any);

    if (!response.ok) {
      console.debug(`[nav] CoinGecko API error for ${coinId}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const price = data[coinId]?.usd ?? null;
    return typeof price === 'number' ? price : null;
  } catch (err) {
    console.debug(`[nav] CoinGecko fetch failed for ${coinId}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Get NAV price for an asset.
 * Try CoinGecko API first, fall back to cached price if API fails.
 */
async function getNAVPrice(symbol: string): Promise<number | null> {
  const coinId = SYMBOL_TO_COINGECKO_ID[symbol];
  if (!coinId) {
    console.debug(`[nav] No CoinGecko mapping for ${symbol}`);
    return null;
  }

  // Try CoinGecko API
  const freshPrice = await fetchPriceFromCoinGecko(coinId);
  if (freshPrice !== null) {
    // Cache the fresh price (1-hour TTL)
    await cacheNAV(symbol, freshPrice).catch(err => {
      console.debug(`[nav] Failed to cache NAV for ${symbol}:`, err instanceof Error ? err.message : String(err));
    });
    return freshPrice;
  }

  // Fall back to cached price if API fails
  const cachedPrice = await getCachedNAV(symbol).catch(err => {
    console.debug(`[nav] Failed to read cached NAV for ${symbol}:`, err instanceof Error ? err.message : String(err));
    return null;
  });
  if (cachedPrice !== null) {
    console.debug(`[nav] Using cached price for ${symbol}: $${cachedPrice}`);
    return cachedPrice;
  }

  return null;
}

// ── NAV management ────────────────────────────────────────────────────────────

/**
 * Refresh NAVs for all assets using CoinGecko real-time prices.
 *
 * Strategy:
 *   1. Try CoinGecko API first (free tier, no auth)
 *   2. Cache successful prices in PostgreSQL (1-hour TTL)
 *   3. Fall back to cached price if API fails or rate-limited
 *   4. Log failures but don't crash the background job
 */
export async function refreshAllNAVs(): Promise<void> {
  const now = new Date().toISOString();
  const results: Array<{ symbol: string; success: boolean; price?: number; error?: string }> = [];

  console.log('[rwa-registry] Starting NAV refresh from CoinGecko...');

  for (const asset of rwaAssets.values()) {
    try {
      const price = await getNAVPrice(asset.symbol);

      if (price !== null && price > 0) {
        asset.nav = price;
        asset.navUpdatedAt = now;
        asset.updatedAt = now;
        results.push({ symbol: asset.symbol, success: true, price });
        console.debug(`[nav] ${asset.symbol}: $${price.toFixed(8)}`);
      } else {
        results.push({ symbol: asset.symbol, success: false, error: 'Price fetch returned null or invalid' });
        console.debug(`[nav] ${asset.symbol}: Failed to fetch price`);
        // Keep existing NAV on failure
        asset.navUpdatedAt = now;
        asset.updatedAt = now;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({ symbol: asset.symbol, success: false, error: errorMsg });
      console.debug(`[nav] ${asset.symbol}: Exception during fetch:`, errorMsg);
      // Keep existing NAV on error
      asset.navUpdatedAt = now;
      asset.updatedAt = now;
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`[rwa-registry] NAV refresh complete: ${successCount}/${rwaAssets.size} assets updated`);
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

/**
 * Cryptocurrency price feed.
 * Uses CoinGecko public API with 60-second in-memory cache.
 */

import { config } from '../config.js';

const COIN_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  LTC: 'litecoin',
  XMR: 'monero',
};

interface PriceCache {
  price:     number;
  updatedAt: number;
}

const cache = new Map<string, PriceCache>();
const CACHE_TTL_MS = 60_000;

export async function getUsdPrice(coin: string): Promise<number> {
  const cached = cache.get(coin);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  const coinId = COIN_IDS[coin.toUpperCase()];
  if (!coinId) throw new Error(`Unknown coin: ${coin}`);

  try {
    const res = await fetch(
      `${config.priceFeedUrl}/simple/price?ids=${coinId}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) throw new Error(`Price feed error ${res.status}`);
    const data = await res.json() as Record<string, { usd: number }>;
    const price = data[coinId]?.usd ?? 0;
    cache.set(coin, { price, updatedAt: Date.now() });
    return price;
  } catch (err) {
    console.warn(`Price fetch failed for ${coin}:`, err);
    return cached?.price ?? 0;
  }
}

export function usdToCrypto(usdAmount: number, pricePerCoin: number): number {
  if (pricePerCoin <= 0) throw new Error('Invalid price');
  return usdAmount / pricePerCoin;
}

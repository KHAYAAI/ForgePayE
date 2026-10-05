/**
 * USD prices for agent holdings.
 *
 * These used to be a hardcoded table (ETH $3,200, BTC $68,000) and USDY,
 * TBILL and BUIDL were all taken as exactly $1 — USDY accrues above $1 — so
 * portfolios, drift and rebalance plans were computed on made-up numbers.
 *
 * Now:
 *   - USDC, USDT and DAI are taken at their $1 peg (an assumption, labelled
 *     as such in every snapshot); a depeg is not detected.
 *   - every other asset needs a quote from PRICE_FEED_URL (GET, JSON
 *     `{ "prices": { "ETH": 2512.3, ... } }`), at most PRICE_MAX_AGE_SEC old.
 *   - with no fresh quote, rateFor() throws PriceUnavailableError and the
 *     request fails with 503: nothing is valued, planned or moved on a guess.
 */

export const PEGGED = new Set(['USDC', 'USDT', 'DAI']);

export class PriceUnavailableError extends Error {
  readonly statusCode = 503;
  constructor(asset: string, why: string) {
    super(`No usable USD price for ${asset}: ${why}`);
    this.name = 'PriceUnavailable';
  }
}

interface Quote { usd: number; asOf: number }
const quotes = new Map<string, Quote>();

function maxAgeMs(): number {
  return Number(process.env['PRICE_MAX_AGE_SEC'] ?? '300') * 1000;
}

/** USD per unit of `asset`. Throws PriceUnavailableError rather than guessing. */
export function rateFor(asset: string, now = Date.now()): number {
  const sym = asset.toUpperCase();
  if (PEGGED.has(sym)) return 1;
  const q = quotes.get(sym);
  if (!q) throw new PriceUnavailableError(sym, 'no quote from the price feed');
  if (now - q.asOf > maxAgeMs()) {
    throw new PriceUnavailableError(sym, `last quote is ${Math.round((now - q.asOf) / 1000)}s old`);
  }
  return q.usd;
}

/** Record quotes (from the feed, or directly in tests). Non-positive prices are ignored. */
export function setQuotes(prices: Record<string, number>, asOf = Date.now()): void {
  for (const [sym, usd] of Object.entries(prices)) {
    if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) quotes.set(sym.toUpperCase(), { usd, asOf });
  }
}

export function clearQuotes(): void {
  quotes.clear();
}

/** Pull quotes from PRICE_FEED_URL. Returns the number of quotes recorded. */
export async function refreshPrices(doFetch: typeof fetch = fetch): Promise<number> {
  const url = process.env['PRICE_FEED_URL'];
  if (!url) return 0;
  const res = await doFetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`price feed returned ${res.status}`);
  const body = (await res.json()) as { prices?: Record<string, number> };
  const prices = body.prices ?? {};
  setQuotes(prices);
  return Object.keys(prices).length;
}

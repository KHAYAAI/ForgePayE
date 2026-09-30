/**
 * The rates that connect a token to the bureau's dollar ledger.
 *
 *   USDC, OUSD  are dollar tokens: one token is one USD (OUSD_USD_RATE can adjust
 *               that, e.g. to 0.998, but defaults to 1).
 *   ZARP        is a rand token: one token is one ZAR, so a dollar amount needs the
 *               USD/ZAR rate.
 *
 * A rand rate that is wrong is money lost, in one direction or the other, on every
 * ZARP payment, so it is not defaulted, not guessed and not allowed to go stale:
 * an operator sets it (PUT /assets/rates/USD-ZAR, admin only), it is stored with
 * who set it and when, and a rate older than FX_MAX_AGE_HOURS (default 24) is
 * treated as absent. Without a fresh rate ZARP cannot be quoted or paid. A live
 * market feed is not wired in; this is the seam where one would go.
 */

import { rateToScaled, scaledToRate, RATE_SCALE } from './asset-math.js';
import type { PegUnit } from './assets.js';

export interface StoredRate {
  pair: string;
  /** Units of the quote currency per one base unit, scaled 1e8. */
  scaled: bigint;
  asOf: Date;
  source: string;
  setBy: string;
}

export interface RateStore {
  latest(pair: string): Promise<StoredRate | null>;
  put(rate: StoredRate): Promise<void>;
}

export class RateUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'RateUnavailableError'; }
}

export const USD_ZAR = 'USD/ZAR';

export interface Quote {
  /** Units of the asset that one USD buys, scaled 1e8. */
  assetPerUsd: bigint;
  /** The rate behind it, for the record. */
  rate: string;
  pair: string;
  asOf: string;
  source: string;
}

export function maxRateAgeMs(env: NodeJS.ProcessEnv = process.env): number {
  const hours = Number(env['FX_MAX_AGE_HOURS'] ?? '24');
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3600_000;
}

/** Peg adjustment for dollar tokens (1 unless an operator says otherwise). */
export function ousdUsdRate(env: NodeJS.ProcessEnv = process.env): bigint {
  const raw = env['OUSD_USD_RATE'];
  return raw ? rateToScaled(raw) : RATE_SCALE;
}

export async function quoteFor(
  symbol: string, unit: PegUnit, store: RateStore, now: Date = new Date(), env: NodeJS.ProcessEnv = process.env,
): Promise<Quote> {
  if (unit === 'USD') {
    // One dollar buys 1/peg tokens: a token worth 0.998 USD takes 1.002 of them.
    const peg = symbol === 'OUSD' ? ousdUsdRate(env) : RATE_SCALE;
    const assetPerUsd = (RATE_SCALE * RATE_SCALE) / peg;
    return { assetPerUsd, rate: scaledToRate(assetPerUsd), pair: `${symbol}/USD`, asOf: now.toISOString(), source: peg === RATE_SCALE ? 'peg' : 'OUSD_USD_RATE' };
  }
  const stored = await store.latest(USD_ZAR);
  if (!stored) throw new RateUnavailableError('no USD/ZAR rate has been set, so ZARP cannot be priced');
  const age = now.getTime() - stored.asOf.getTime();
  if (age > maxRateAgeMs(env)) {
    throw new RateUnavailableError(`the USD/ZAR rate was set ${Math.round(age / 3600_000)}h ago (limit ${maxRateAgeMs(env) / 3600_000}h); set a fresh one`);
  }
  if (age < -5 * 60_000) throw new RateUnavailableError('the USD/ZAR rate is dated in the future');
  return { assetPerUsd: stored.scaled, rate: scaledToRate(stored.scaled), pair: USD_ZAR, asOf: stored.asOf.toISOString(), source: stored.source };
}

/** Postgres-backed store. */
export function dbRateStore(getDb: () => { query: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }> }): RateStore {
  return {
    async latest(pair) {
      const r = await getDb().query(`SELECT pair, rate, as_of, source, set_by FROM fx_rates WHERE pair = $1 ORDER BY as_of DESC, id DESC LIMIT 1`, [pair]);
      const row = r.rows[0];
      return row ? { pair: row.pair, scaled: rateToScaled(String(row.rate)), asOf: new Date(row.as_of), source: row.source, setBy: row.set_by } : null;
    },
    async put(rate) {
      await getDb().query(`INSERT INTO fx_rates (pair, rate, as_of, source, set_by) VALUES ($1, $2, $3, $4, $5)`,
        [rate.pair, scaledToRate(rate.scaled), rate.asOf.toISOString(), rate.source, rate.setBy]);
    },
  };
}

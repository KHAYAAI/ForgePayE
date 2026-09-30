/**
 * Exact conversion between a USD value and units of an ERC-20 asset.
 *
 * All of it is integer arithmetic. The float a caller hands in (`amountUsd`) is
 * turned into whole micro-dollars once, at the edge; a rate is held as a scaled
 * integer; the result is a bigint of token units. Nothing here can drift by a
 * rounding error, and it doesn't assume any decimals — USDC has 6, but the
 * assets this is used for are read from the chain.
 */

/** Rates are held as integers scaled by 1e8: 18.42 ZAR per USD is 1_842_000_000n. */
export const RATE_SCALE = 100_000_000n;
const MICRO = 1_000_000n;

export type Rounding = 'ceil' | 'floor';

/** USD → whole micro-dollars. Amounts finer than a micro-dollar are rejected, not silently rounded. */
export function usdToMicro(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) throw new RangeError('amount must be a positive number');
  const micro = Math.round(usd * 1e6);
  if (micro <= 0) throw new RangeError('amount is below one micro-dollar');
  if (Math.abs(usd * 1e6 - micro) > 1e-3) throw new RangeError('amount has more than 6 decimal places');
  return BigInt(micro);
}

/** A decimal rate ("18.4213" or a number) → scaled integer. Non-positive or absurd rates are refused. */
export function rateToScaled(rate: string | number): bigint {
  const s = typeof rate === 'number' ? rate.toFixed(8) : String(rate).trim();
  if (!/^\d+(\.\d{1,8})?$/.test(s)) throw new RangeError(`"${rate}" is not a positive decimal with at most 8 places`);
  const [whole, frac = ''] = s.split('.');
  const scaled = BigInt(whole) * RATE_SCALE + BigInt(frac.padEnd(8, '0'));
  if (scaled <= 0n) throw new RangeError('rate must be positive');
  return scaled;
}

/** scaled integer → decimal string, trailing zeros trimmed. */
export function scaledToRate(scaled: bigint): string {
  const whole = scaled / RATE_SCALE;
  const frac = (scaled % RATE_SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function divide(numerator: bigint, denominator: bigint, mode: Rounding): bigint {
  const q = numerator / denominator;
  return mode === 'ceil' && numerator % denominator !== 0n ? q + 1n : q;
}

/**
 * Token units worth `usdMicro` micro-dollars when one USD buys `assetPerUsd`
 * (scaled) of the asset. Money coming *in* rounds up, so a payer never credits
 * more than they sent; money going *out* rounds down, so we never send more than
 * was approved.
 */
export function usdMicroToUnits(usdMicro: bigint, assetPerUsd: bigint, decimals: number, mode: Rounding): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new RangeError('decimals out of range');
  return divide(usdMicro * assetPerUsd * 10n ** BigInt(decimals), MICRO * RATE_SCALE, mode);
}

/** Token units → decimal string in whole tokens ("1234.5"). */
export function unitsToDecimal(units: bigint, decimals: number): string {
  if (decimals === 0) return units.toString();
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const frac = (units % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

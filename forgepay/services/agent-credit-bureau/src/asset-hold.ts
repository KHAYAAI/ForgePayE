import { PAYMENT_ASSETS, type PaymentAsset } from './types';

/**
 * Which assets the bureau will accept payment in and pay furnishers in.
 *
 *   BUREAU_ENABLED_ASSETS=USDC            only these (comma-separated)
 *   (unset, production)                   USDC only: ZARP and OUSD are on hold until someone turns them on by name
 *   (unset, anywhere else)                all of them, as before
 *
 * This is the bureau's own switch, independent of the gateway's ASSETS_ENABLED: two locks, so that holding an asset back
 * does not depend on one setting being right. A held asset is refused for new top-ups and for choosing it as a payout
 * asset, and a furnisher already set to it is NOT paid in USDC instead (that would be a payment in a token they did not
 * choose): their settlement is left unsettled and reported, the amount stays owed.
 */
export function enabledAssets(env: NodeJS.ProcessEnv = process.env): readonly PaymentAsset[] {
  const raw = env['BUREAU_ENABLED_ASSETS'];
  if (raw === undefined || raw.trim() === '') {
    return env['NODE_ENV'] === 'production' ? ['USDC'] : PAYMENT_ASSETS;
  }
  const want = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return PAYMENT_ASSETS.filter((a) => want.includes(a));
}

export function isAssetEnabled(a: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return (enabledAssets(env) as readonly string[]).includes(a.toUpperCase());
}

export const heldMessage = (a: string) => `${a} is on hold: the bureau currently accepts and pays in ${enabledAssets().join(', ') || 'no assets'} only`;

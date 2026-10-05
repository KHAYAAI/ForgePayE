/**
 * Who may hold which tokenised asset.
 *
 * Every asset in the catalogue says requiresKyc (and some require an
 * accredited investor or a jurisdiction), but nothing checked: any merchant
 * key could open a position in anything. A merchant's eligibility is now an
 * explicit record set by an admin after verification happens elsewhere (the
 * KYC itself is not done here), and position opening fails closed without it.
 */
import type { RWAAsset } from './types';

export interface Eligibility {
  merchantId:   string;
  kycVerified:  boolean;
  accredited:   boolean;
  /** ISO 3166-1 alpha-2 */
  jurisdiction: string;
  verifiedBy:   string;
  verifiedAt:   string;
}

export const eligibility = new Map<string, Eligibility>();

/** Why this merchant may not hold this asset, or null if they may. */
export function eligibilityError(e: Eligibility | undefined, asset: RWAAsset): string | null {
  if (asset.requiresKyc || asset.requiresAccreditedInvestor || !asset.supportedJurisdictions.includes('all')) {
    if (!e) return `No verified eligibility on record; ${asset.symbol} requires KYC`;
  }
  if (asset.requiresKyc && !e?.kycVerified) return `${asset.symbol} requires a verified KYC record`;
  if (asset.requiresAccreditedInvestor && !e?.accredited) return `${asset.symbol} is only for accredited investors`;
  if (!asset.supportedJurisdictions.includes('all')) {
    const j = e?.jurisdiction?.toUpperCase();
    if (!j || !asset.supportedJurisdictions.map((s) => s.toUpperCase()).includes(j)) {
      return `${asset.symbol} is not offered in ${j ?? 'an unknown jurisdiction'}`;
    }
  }
  return null;
}

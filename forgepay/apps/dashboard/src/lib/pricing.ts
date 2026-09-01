import type { ProductKey } from './products';

/**
 * Pricing, per platform.
 *
 * Each product is sold on its own terms — a bureau customer who never touches
 * payments should not be quoted a payments tier, and a payments merchant
 * pulling credit files is a different price to a standalone lender. So pricing
 * is keyed by product rather than being one global table.
 *
 * ── On the numbers ───────────────────────────────────────────────────────────
 *
 * Only two figures below are load-bearing today, and both come from code
 * rather than a slide:
 *
 *   - the bureau's per-inquiry fee, which is `INQUIRY_FEE_USD` in
 *     agent-credit-bureau/src/grade.ts and is actually charged
 *   - the payments tiers, taken from apps/web/src/lib/pricing.ts
 *
 * Everything marked `pending: true` has no agreed price yet. It is left
 * explicitly unpriced rather than filled with a plausible-looking number,
 * because a fabricated price that reaches a pricing page is worse than a
 * visible gap.
 *
 * ── A known conflict ─────────────────────────────────────────────────────────
 *
 * apps/web currently ships two contradictory payments schemes and renders both
 * on one page: tier cards at Free/$28 with card at 2.8%/2.4%, and an ROI
 * calculator at $5/month with card at 2% + $0.20. The tier version is encoded
 * here because it is the structured one, but this is not a resolution — the
 * conflict needs a decision before either is quoted publicly.
 */

export type BillingUnit = 'per-month' | 'per-inquiry' | 'per-transaction' | 'percent-of-volume';

export interface PriceLine {
  label: string;
  /** Integer USD cents, or null when the price is a percentage or unset. */
  amountUsdCents: number | null;
  /** Percentage rate as a decimal (0.024 = 2.4%), when the line is volume-based. */
  rate?: number;
  unit: BillingUnit;
  note?: string;
}

export interface ProductTier {
  key: string;
  name: string;
  monthlyUsdCents: number | null;
  /** What this tier includes, in the customer's words. */
  includes: string[];
  lines: PriceLine[];
  limits?: Record<string, string>;
}

export interface ProductPricing {
  product: ProductKey;
  /** True when no price has been agreed — the UI must not quote a number. */
  pending: boolean;
  model: string;
  tiers: ProductTier[];
  /**
   * Cross-product adjustments: the mesh made economic. A bureau inquiry is
   * cheaper for a customer who also runs payments, because that customer is
   * also contributing the data the bureau sells.
   */
  bundleAdjustments?: { whenAlsoHas: ProductKey; effect: string; pending: boolean }[];
}

// ── Payments ─────────────────────────────────────────────────────────────────

const PAYMENTS: ProductPricing = {
  product: 'payments',
  pending: false,
  model: 'Monthly platform fee plus a take rate per transaction, by rail.',
  tiers: [
    {
      key: 'free',
      name: 'Free',
      monthlyUsdCents: 0,
      includes: ['Card payments', 'Stablecoin and crypto', 'Basic analytics', 'Webhooks'],
      lines: [
        { label: 'Card',              amountUsdCents: 24, rate: 0.028, unit: 'per-transaction' },
        { label: 'Stablecoin/crypto', amountUsdCents: null, rate: 0.018, unit: 'percent-of-volume', note: 'plus gas' },
      ],
      limits: { monthlyVolume: '$25,000', teamSeats: '1' },
    },
    {
      key: 'standard',
      name: 'Standard',
      monthlyUsdCents: 2_800,
      includes: [
        'Everything in Free',
        'Unlimited volume',
        'Merchant of Record',
        'Tax in 200+ jurisdictions',
        'Subscription billing and dunning',
      ],
      lines: [
        { label: 'Card',              amountUsdCents: 24, rate: 0.024, unit: 'per-transaction' },
        { label: 'Stablecoin/crypto', amountUsdCents: null, rate: 0.014, unit: 'percent-of-volume', note: 'plus gas' },
      ],
      limits: { monthlyVolume: 'Unlimited', teamSeats: '10' },
    },
  ],
};

// ── Credit Bureau ────────────────────────────────────────────────────────────

const CREDIT_BUREAU: ProductPricing = {
  product: 'credit-bureau',
  pending: false,
  model: 'Prepaid balance, debited per credit-file pull. No monthly minimum.',
  tiers: [
    {
      key: 'standard',
      name: 'Pay per inquiry',
      monthlyUsdCents: 0,
      includes: [
        'Credit file and lender report pulls',
        'Prepaid balance, topped up in USDC or by card',
        'Contribute data and earn a share of inquiry revenue',
      ],
      lines: [
        {
          label: 'Credit-file pull',
          amountUsdCents: 280, // INQUIRY_FEE_USD = 2.80 in agent-credit-bureau/src/grade.ts
          unit: 'per-inquiry',
          note: 'Charged before data is released; a declined charge records no inquiry.',
        },
      ],
    },
  ],
  bundleAdjustments: [
    {
      whenAlsoHas: 'payments',
      effect: 'Reduced per-inquiry rate — payments customers furnish the transaction data the bureau scores.',
      pending: true,
    },
  ],
};

// ── Not yet priced ───────────────────────────────────────────────────────────

const unpriced = (product: ProductKey, model: string): ProductPricing => ({
  product,
  pending: true,
  model,
  tiers: [],
});

export const PRICING: Record<ProductKey, ProductPricing> = {
  payments:        PAYMENTS,
  'credit-bureau': CREDIT_BUREAU,
  treasury:        unpriced('treasury',   'Expected: monthly platform fee plus basis points on balances under management.'),
  wallet:          unpriced('wallet',     'Expected: per-wallet monthly fee plus per-signature or per-transfer charge.'),
  custody:         unpriced('custody',    'Expected: monthly fee per custodied key or wallet, likely tiered by assets under custody.'),
  compliance:      unpriced('compliance', 'Expected: monthly fee by screening volume, plus per-alert or per-report charge.'),
};

/** Kept for the payments calculator, which was written against this shape. */
export const PRICING_TIERS = Object.fromEntries(
  PAYMENTS.tiers.map((t) => [t.key, t]),
) as Record<string, ProductTier>;

export function pricingFor(product: ProductKey): ProductPricing {
  return PRICING[product];
}

/** True when a product has no agreed price and must not be quoted. */
export function isPending(product: ProductKey): boolean {
  return PRICING[product].pending;
}

export function formatUsdCents(cents: number | null): string {
  if (cents === null) return '—';
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

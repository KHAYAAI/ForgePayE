/**
 * The product catalog, and what a merchant is entitled to.
 *
 * ForgePay is not one product — it is several that a customer selects among.
 * Each is an independent entry point (payments without the bureau, the bureau
 * without treasury), and each is priced on its own terms. This module is the
 * dashboard's view of that.
 *
 * The server side of record is `unified-router`'s `entitlements` table, with
 * `customers.products` as its GIN-indexed read cache. Until that service is
 * mounted, `/api/customer` resolves entitlements from the dashboard's own
 * database — see that route for why, and for what changes when it is.
 *
 * IMPORTANT: everything here is presentation. `ProductGate` hides UI a
 * merchant has not bought, which is a courtesy, not a control — hiding a nav
 * item does not stop anyone calling the API behind it. Every route that
 * belongs to a product must check entitlement server-side for itself; see
 * `requireProduct()` in lib/entitlements.ts.
 */

export type ProductKey =
  | 'payments'
  | 'credit-bureau'
  | 'treasury'
  | 'wallet'
  | 'custody'
  | 'compliance';

export type Availability = 'available' | 'waitlist' | 'private' | 'retired';

export interface Product {
  key: ProductKey;
  name: string;
  tagline: string;
  /** What the merchant actually gets — shown on the selection screen. */
  highlights: string[];
  availability: Availability;
  /** Products this one needs to function. Empty means a true standalone. */
  requires: ProductKey[];
  /** Route prefix this product owns in the dashboard. */
  basePath: string;
}

/**
 * Availability reflects what can honestly be sold today, not what exists in
 * the repository — payments is gated on a licence that has not been granted,
 * and treasury and wallet sit on services that still lose state on restart.
 * Selling a platform we cannot operate is worse than showing it as upcoming.
 */
export const PRODUCTS: Product[] = [
  {
    key: 'credit-bureau',
    name: 'Credit Bureau',
    tagline: 'Credit files and underwriting reports for autonomous agents',
    highlights: [
      'Credit score per agent, from real payment behaviour',
      'Lender reports with reason codes',
      'Contribute data and earn a share of inquiry revenue',
    ],
    availability: 'available',
    requires: [],
    basePath: '/credit-bureau',
  },
  {
    key: 'payments',
    name: 'Payments',
    tagline: 'One API for cards, bank transfers, stablecoins and crypto',
    highlights: [
      'Card, EFT, USDC and crypto through one integration',
      'Merchant of Record — tax collected and remitted for you',
      'Routing across rails by cost and success rate',
    ],
    availability: 'private',
    requires: [],
    basePath: '/payments',
  },
  {
    key: 'treasury',
    name: 'Treasury',
    tagline: 'Corporate treasury, yield and liquidity management',
    highlights: [
      'Multi-entity balances and netting',
      'Yield on idle balances',
      'Approval workflows for outbound movement',
    ],
    availability: 'waitlist',
    requires: [],
    basePath: '/treasury',
  },
  {
    key: 'wallet',
    name: 'Wallet',
    tagline: 'Programmable wallets for agents and operators',
    highlights: [
      'Wallets provisioned per agent',
      'Spending policies enforced before signing',
      'Backed by the Custody platform for key security',
    ],
    availability: 'waitlist',
    // Wallet holds balances; Custody is what actually secures the keys behind
    // them. Split into its own platform so it can also be sold standalone —
    // to a business that wants MPC custody under its own wallet, not ours.
    requires: ['custody'],
    basePath: '/wallet',
  },
  {
    key: 'custody',
    name: 'Custody',
    tagline: 'MPC key custody, sellable on its own or underneath any wallet',
    highlights: [
      'Threshold signing — no single key ever exists in one place',
      'Policy-gated signing, enforced before a signature is produced',
      'Also secures ForgePay\'s own Wallet platform end to end',
    ],
    availability: 'waitlist',
    requires: [],
    basePath: '/custody',
  },
  {
    key: 'compliance',
    name: 'Compliance',
    tagline: 'AML monitoring, sanctions screening and regulatory reporting',
    highlights: [
      'Transaction monitoring with configurable rules',
      'Sanctions and PEP screening',
      'Regulatory report generation',
    ],
    availability: 'waitlist',
    requires: [],
    basePath: '/compliance',
  },
];

export const PRODUCT_BY_KEY: Record<ProductKey, Product> = Object.fromEntries(
  PRODUCTS.map((p) => [p.key, p]),
) as Record<ProductKey, Product>;

/** Products a merchant can select for themselves right now. */
export function selectableProducts(): Product[] {
  return PRODUCTS.filter((p) => p.availability === 'available' || p.availability === 'waitlist');
}

/**
 * Resolve which route prefix a request belongs to, so a server-side check can
 * ask "which product does this endpoint sell?" without every route repeating
 * the mapping.
 */
export function productForPath(pathname: string): ProductKey | null {
  const hit = PRODUCTS.find((p) => pathname.startsWith(p.basePath));
  return hit?.key ?? null;
}

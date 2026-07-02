/**
 * FORGE Payments routing tier engine.
 *
 * Every payment is routed by amount and actor type across the three
 * interconnected signing layers:
 *
 *   < $100K          → forge-wallet    — wallet layer signs directly
 *   $100K – $1M      → optimal-path    — Stripe ACH → Circle USDC fallback chain
 *   > $1M            → forge-custody   — policy engine + multi-approval +
 *                                        4-of-7 threshold signature
 *
 * Overrides:
 *   - institutional customers always route to forge-custody
 *   - credit-line draws (agent payments on terms approved by Enterprise
 *     Treasury) route to forge-custody regardless of amount, because the
 *     funds move from the enterprise custody account
 */

export type PaymentRoute = 'forge-wallet' | 'optimal-path' | 'forge-custody';

export const WALLET_TIER_MAX_USD = Number(process.env.WALLET_TIER_MAX_USD ?? 100_000);
export const CUSTODY_TIER_MIN_USD = Number(process.env.CUSTODY_TIER_MIN_USD ?? 1_000_000);

export interface RoutingContext {
  amountUsd: number;
  /** did:forge:user_* | did:forge:agent_* | merchant/customer id */
  actorId?: string;
  /** true for bank/fund/enterprise custody customers */
  institutional?: boolean;
  /** set when an Enterprise-Treasury-approved credit line funds the payment */
  creditLineId?: string;
}

export interface RoutingDecision {
  route: PaymentRoute;
  reason: string;
}

export function decidePaymentRoute(ctx: RoutingContext): RoutingDecision {
  if (ctx.creditLineId) {
    return {
      route: 'forge-custody',
      reason: `credit-line draw ${ctx.creditLineId} settles from enterprise custody`,
    };
  }
  if (ctx.institutional) {
    return { route: 'forge-custody', reason: 'institutional customer — custody policy applies' };
  }
  if (ctx.amountUsd >= CUSTODY_TIER_MIN_USD) {
    return {
      route: 'forge-custody',
      reason: `amount ≥ $${CUSTODY_TIER_MIN_USD.toLocaleString('en-US')} requires threshold signing`,
    };
  }
  if (ctx.amountUsd >= WALLET_TIER_MAX_USD) {
    return {
      route: 'optimal-path',
      reason: 'mid-tier amount — routed across the Stripe ACH → Circle USDC fallback chain',
    };
  }
  return { route: 'forge-wallet', reason: 'consumer/agent-tier amount — wallet signs directly' };
}

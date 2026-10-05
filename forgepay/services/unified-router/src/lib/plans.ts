/**
 * Kill Bill plan names — the only ones this service may subscribe anyone to.
 *
 * Kill Bill rejects a subscription to a plan its catalog doesn't have, and
 * checkout used to ask for `payments-${tierId}` against a catalog that had
 * no such plan, so every paid checkout ended in a failed provisioning step
 * after the customer had been charged. This list mirrors
 * billing-engine/config/catalog/forgepay-base-catalog.xml;
 * __tests__/plans.test.ts reads that file and fails if the two drift apart.
 */

export const CATALOG_PLANS = [
  'payments-free',
  'payments-standard',
  'forgepay-growth-monthly',
  'forgepay-growth-annual',
  'forgepay-ai-tokens-monthly',
] as const;

export type CatalogPlan = (typeof CATALOG_PLANS)[number];

export function isCatalogPlan(name: string): name is CatalogPlan {
  return (CATALOG_PLANS as readonly string[]).includes(name);
}

/** The plan for a pricing.yaml tier, or null if the catalog has none. */
export function paymentsPlanForTier(tierId: string): CatalogPlan | null {
  const name = `payments-${tierId}`;
  return isCatalogPlan(name) ? name : null;
}

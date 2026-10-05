/**
 * Checkout and Kill Bill must agree on plan names and prices.
 *
 * Checkout subscribed customers to `payments-${tierId}` while the catalog had
 * no such plan, so every paid checkout charged the customer and then failed
 * to provision. These read the real files rather than a copy of them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { CATALOG_PLANS, paymentsPlanForTier } from '../src/lib/plans.js';

const catalogXml = readFileSync(
  resolve(__dirname, '../../billing-engine/config/catalog/forgepay-base-catalog.xml'), 'utf8',
);
const pricing = yaml.load(
  readFileSync(resolve(__dirname, '../../../config/pricing.yaml'), 'utf8'),
) as { tiers: Record<string, { monthly_fee: number }> };

const catalogPlanNames = [...catalogXml.matchAll(/<plan name="([^"]+)"/g)].map((m) => m[1]);

function evergreenUsdPrice(plan: string): number | null {
  const block = catalogXml.split(`<plan name="${plan}">`)[1]?.split('</plan>')[0] ?? '';
  const evergreen = block.split('<finalPhase')[1] ?? '';
  const m = evergreen.match(/<currency>USD<\/currency><value>([\d.]+)<\/value>/);
  return m ? Number(m[1]) : null;
}

describe('Kill Bill plans', () => {
  it('lists exactly the plans the catalog defines', () => {
    expect([...CATALOG_PLANS].sort()).toEqual([...catalogPlanNames].sort());
  });

  it('has a plan for every pricing tier, at the same monthly price', () => {
    for (const [tierId, tier] of Object.entries(pricing.tiers)) {
      const plan = paymentsPlanForTier(tierId);
      expect(plan, `tier ${tierId}`).not.toBeNull();
      expect(evergreenUsdPrice(plan!), `price of ${plan}`).toBe(tier.monthly_fee);
    }
  });

  it('has no plan for an unknown tier', () => {
    expect(paymentsPlanForTier('enterprise')).toBeNull();
  });
});

import { NextResponse } from 'next/server';
import { query, execute } from './db';
import type { ProductKey } from './products';

/**
 * Server-side product entitlement.
 *
 * `ProductGate` and the sidebar hide what a merchant has not bought. That is
 * presentation — anyone can still call the API directly. This module is the
 * control: a route belonging to a product asks `requireProduct()` before doing
 * anything, and a merchant without it gets 403 regardless of what the UI shows.
 *
 * Denials are recorded to the revenue ontology rather than merely refused.
 * "Who tried to use what they had not bought" is the highest-intent upgrade
 * signal the platform produces, and throwing it away to save one INSERT would
 * be a poor trade.
 */

export interface Entitlement {
  product_key: ProductKey;
  status: 'trialing' | 'active' | 'past_due' | 'cancelled';
  plan: string | null;
  trial_ends_at: string | null;
}

/** Products this merchant may currently use — trials count, cancellations do not. */
export async function activeProducts(merchantId: string): Promise<ProductKey[]> {
  const rows = await query<{ product_key: ProductKey }>(
    `SELECT product_key FROM entitlements
      WHERE merchant_id = $1 AND status IN ('active','trialing')
      ORDER BY product_key`,
    [merchantId],
  );
  return rows.map((r) => r.product_key);
}

export async function listEntitlements(merchantId: string): Promise<Entitlement[]> {
  return query<Entitlement>(
    `SELECT product_key, status, plan, trial_ends_at
       FROM entitlements WHERE merchant_id = $1 ORDER BY product_key`,
    [merchantId],
  );
}

export async function hasProduct(merchantId: string, product: ProductKey): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM entitlements
      WHERE merchant_id = $1 AND product_key = $2 AND status IN ('active','trialing')`,
    [merchantId, product],
  );
  return rows.length > 0;
}

/** Grant a product. Idempotent — re-selecting one already held reactivates it rather than erroring. */
export async function grantProduct(
  merchantId: string,
  product: ProductKey,
  opts: { plan?: string; trialDays?: number } = {},
): Promise<void> {
  const trialEnds = opts.trialDays
    ? new Date(Date.now() + opts.trialDays * 86_400_000)
    : null;

  await execute(
    `INSERT INTO entitlements (merchant_id, product_key, status, plan, trial_ends_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (merchant_id, product_key) DO UPDATE
       SET status        = EXCLUDED.status,
           plan          = EXCLUDED.plan,
           trial_ends_at = EXCLUDED.trial_ends_at,
           cancelled_at  = NULL`,
    [merchantId, product, trialEnds ? 'trialing' : 'active', opts.plan ?? null, trialEnds],
  );

  await recordRevenueEvent({
    merchantId,
    product,
    eventType: trialEnds ? 'TRIAL_STARTED' : 'SUBSCRIPTION_STARTED',
    metadata: { plan: opts.plan ?? null },
  });
}

export async function cancelProduct(merchantId: string, product: ProductKey): Promise<void> {
  await execute(
    `UPDATE entitlements SET status='cancelled', cancelled_at=NOW()
      WHERE merchant_id=$1 AND product_key=$2`,
    [merchantId, product],
  );
  await recordRevenueEvent({ merchantId, product, eventType: 'SUBSCRIPTION_CANCELLED' });
}

// ── Revenue ontology ─────────────────────────────────────────────────────────

export interface RevenueEventInput {
  merchantId: string | null;
  product: ProductKey | string;
  eventType: string;
  amountUsdCents?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Append to the revenue ontology — the one table every product writes to,
 * whichever entry point the customer came through. Integer cents throughout:
 * this is the table that has to reconcile, and floating-point money drifts.
 *
 * Best-effort: a failed analytics write must never break the request that
 * produced it.
 */
export async function recordRevenueEvent(e: RevenueEventInput): Promise<void> {
  try {
    await execute(
      `INSERT INTO revenue_events (merchant_id, product, event_type, amount_usd_cents, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        e.merchantId,
        e.product,
        e.eventType,
        e.amountUsdCents ?? 0,
        JSON.stringify(e.metadata ?? {}),
      ],
    );
  } catch (err) {
    console.error('[revenue] failed to record event (request proceeds):', e.eventType, err);
  }
}

// ── Route guard ──────────────────────────────────────────────────────────────

export class UnlicensedProductError extends Error {
  readonly status = 403;
  constructor(readonly product: ProductKey) {
    super(`This account does not include ${product}.`);
    this.name = 'UnlicensedProductError';
  }
}

/**
 * Gate a route on a product. Throws `UnlicensedProductError` when the merchant
 * does not hold it, having first recorded the attempt.
 */
export async function requireProduct(merchantId: string, product: ProductKey): Promise<void> {
  if (await hasProduct(merchantId, product)) return;

  await recordRevenueEvent({
    merchantId,
    product,
    eventType: 'LICENSING_DENIED',
    metadata: { reason: 'unlicensed_product_access' },
  });

  throw new UnlicensedProductError(product);
}

/** Turn an UnlicensedProductError into the 403 the client expects, with somewhere to go. */
export function unlicensedResponse(err: UnlicensedProductError): NextResponse {
  return NextResponse.json(
    {
      error: 'unlicensed_product',
      product: err.product,
      message: err.message,
      upgradeUrl: `/products?add=${err.product}`,
    },
    { status: err.status },
  );
}

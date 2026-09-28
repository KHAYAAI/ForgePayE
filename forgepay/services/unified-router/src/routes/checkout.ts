/**
 * Checkout — cart/plan selection -> payment method -> confirmation.
 *
 * The one commercial motion in this service reachable with no credential at
 * all (see auth.ts's PUBLIC_ROUTES) — a prospect signing up has no customer
 * key yet, and giving the browser the operator key to bootstrap one would
 * hand out the platform's master credential. Public by necessity, not by
 * oversight; everything it does is scoped to creating exactly one thing
 * (a checkout session, then a customer) and every price it charges comes from
 * pricing.yaml server-side, never from the request body.
 *
 * Two payment paths converge on the same confirm step:
 *   card  -> Hyperswitch PaymentIntent, confirmed client-side via their Web
 *            SDK against the client_secret this returns; this route re-checks
 *            the result server-side before trusting it (lib/hyperswitch-client.ts).
 *   usdc  -> stablecoin-gateway x402 payment intent (lib/stablecoin-client.ts),
 *            the same contract the bureau's own billing.ts already uses.
 *
 * Free tier skips payment entirely and provisions immediately.
 *
 * Failure is always a response, never a hang: a declined card, a stalled x402
 * payment past its TTL, or an unreachable upstream all return a distinct,
 * named status the frontend can render — see CheckoutStatus below.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { getTier } from '../lib/pricing.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import {
  createPaymentIntent, getPayment, SUCCEEDED_STATUSES, FAILED_STATUSES,
} from '../lib/hyperswitch-client.js';
import { requestX402Payment, verifyX402Payment } from '../lib/stablecoin-client.js';
import * as killbill from '../lib/killbill-client.js';

const CreateSessionSchema = z.object({
  email: z.string().email(),
  businessName: z.string().min(1).max(200),
  tierId: z.string().min(1),
  paymentMethod: z.enum(['card', 'usdc']).optional(), // absent/ignored for a $0 tier
});

interface CheckoutSessionRow {
  id: string;
  email: string;
  business_name: string | null;
  tier_id: string;
  monthly_fee_cents: number;
  payment_method: string | null;
  status: 'pending' | 'succeeded' | 'declined' | 'stalled' | 'expired';
  hyperswitch_payment_id: string | null;
  x402_receipt_id: string | null;
  customer_id: string | null;
  failure_reason: string | null;
  expires_at: string;
}

/** Every state the frontend has to render. Nothing outside this set is ever returned. */
type CheckoutStatus = 'succeeded' | 'pending_card' | 'pending_usdc' | 'declined' | 'stalled' | 'expired' | 'error';

async function getSession(id: string): Promise<CheckoutSessionRow | undefined> {
  const result = await db.query<CheckoutSessionRow>(
    'public',
    `SELECT * FROM checkout_sessions WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function markSession(
  id: string,
  fields: Partial<Pick<CheckoutSessionRow, 'status' | 'customer_id' | 'failure_reason'>>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i}`);
    params.push(v);
    i += 1;
  }
  sets.push(`updated_at = NOW()`);
  params.push(id);
  await db.query('public', `UPDATE checkout_sessions SET ${sets.join(', ')} WHERE id = $${i}`, params);
}

/**
 * Provision the actually-paid-for account: a customers row plus a Kill Bill
 * account and subscription. Shared by the free-tier immediate path and the
 * card/usdc confirm path so both create identical state.
 */
async function provision(session: CheckoutSessionRow): Promise<{ customerId: string }> {
  const kb = await killbill.createAccount(session.email, session.business_name ?? session.email, 'USD');
  await killbill.createSubscription({
    accountId:   kb.accountId,
    planName:    `payments-${session.tier_id}`,
    externalKey: `payments-${session.email}`,
  });

  const customer = await db.query<{ id: string }>(
    'public',
    `INSERT INTO customers (tenant_id, email, name, status, products, subscriptions, kb_account_id)
     VALUES (gen_random_uuid(), $1, $2, 'active', ARRAY['payments'],
             jsonb_build_object('payments', jsonb_build_object(
               'plan_name', $3, 'granted_at', NOW()
             )),
             $4)
     ON CONFLICT (tenant_id, email) DO UPDATE SET
       products = array_append(customers.products, 'payments'),
       kb_account_id = EXCLUDED.kb_account_id,
       updated_at = NOW()
     RETURNING id`,
    [session.email, session.business_name ?? session.email, `payments-${session.tier_id}`, kb.accountId],
  );

  const customerId = customer.rows[0]!.id;

  // Best-effort canonical event — a checkout failing here shouldn't undo a
  // real provisioning that already succeeded, so this is logged, not thrown.
  try {
    await db.query(
      'public',
      `INSERT INTO forgepay_events
         (id, type, source, merchant_id, occurred_at, processed_at, data, raw_payload, source_event_id, api_version)
       VALUES (gen_random_uuid(), 'customer.subscribed', 'checkout', $1, NOW(), NOW(), $2, $2, $3, '2024-01-01')
       ON CONFLICT (source_event_id) DO NOTHING`,
      [
        customerId,
        JSON.stringify({ tierId: session.tier_id, monthlyFeeCents: session.monthly_fee_cents, paymentMethod: session.payment_method }),
        `checkout_session:${session.id}`,
      ],
    );
  } catch (err) {
    logger.error({ err, sessionId: session.id }, '[checkout] provisioned but failed to write canonical event');
  }

  return { customerId };
}

export async function buildCheckoutRoutes(app: FastifyInstance) {
  // ── GET /v1/pricing — the one place the frontend reads prices from. ────────
  app.get('/v1/pricing', async (_req, reply) => {
    try {
      const { loadPricing } = await import('../lib/pricing.js');
      return reply.send({ data: loadPricing() });
    } catch (err) {
      logger.error({ err }, '[checkout] pricing.yaml unreadable');
      return reply.status(503).send({ error: 'PricingUnavailable', message: 'Pricing could not be loaded. Try again shortly.' });
    }
  });

  // ── POST /v1/checkout/sessions — start checkout for one tier. ──────────────
  app.post('/v1/checkout/sessions', async (req, reply) => {
    const parse = CreateSessionSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const { email, businessName, tierId, paymentMethod } = parse.data;

    const lookup = getTier(tierId);
    if (!lookup.ok) {
      return reply.status(400).send({ error: 'UnknownTier', message: `No such tier "${tierId}".`, knownTiers: lookup.knownTiers });
    }
    const tier = lookup.tier;
    const monthlyFeeCents = Math.round(tier.monthlyFee * 100);

    if (monthlyFeeCents > 0 && !paymentMethod) {
      return reply.status(400).send({ error: 'ValidationError', message: `${tier.name} requires a paymentMethod ("card" or "usdc").` });
    }

    const expiresAt = new Date(Date.now() + config.checkout.sessionTtlMinutes * 60_000);
    const inserted = await db.query<{ id: string }>(
      'public',
      `INSERT INTO checkout_sessions (email, business_name, tier_id, monthly_fee_cents, payment_method, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [email, businessName, tierId, monthlyFeeCents, monthlyFeeCents === 0 ? null : paymentMethod, expiresAt.toISOString()],
    );
    const sessionId = inserted.rows[0]!.id;

    // ── Free tier: nothing to pay, provision immediately. ─────────────────────
    if (monthlyFeeCents === 0) {
      try {
        const session = (await getSession(sessionId))!;
        const { customerId } = await provision(session);
        await markSession(sessionId, { status: 'succeeded', customer_id: customerId });
        return reply.status(201).send({ sessionId, status: 'succeeded' satisfies CheckoutStatus, customerId, tier: tier.name });
      } catch (err) {
        logger.error({ err, sessionId }, '[checkout] free-tier provisioning failed');
        await markSession(sessionId, { status: 'declined', failure_reason: 'Provisioning failed — try again or contact support.' });
        return reply.status(502).send({ sessionId, status: 'error' satisfies CheckoutStatus, message: 'Could not create your account. Try again or contact support.' });
      }
    }

    // ── Card: create a Hyperswitch intent, hand the frontend what it needs. ───
    if (paymentMethod === 'card') {
      const intent = await createPaymentIntent({
        amountCents: monthlyFeeCents,
        currency: 'USD',
        description: `FORGE Payments — ${tier.name} plan`,
        sessionId,
        customerEmail: email,
      });
      if (!intent.ok) {
        await markSession(sessionId, { status: 'declined', failure_reason: intent.message });
        return reply.status(502).send({ sessionId, status: 'error' satisfies CheckoutStatus, message: 'Card payment is temporarily unavailable. Try USDC, or try again shortly.' });
      }
      await db.query('public', `UPDATE checkout_sessions SET hyperswitch_payment_id = $1, updated_at = NOW() WHERE id = $2`, [intent.paymentId, sessionId]);
      return reply.status(201).send({
        sessionId,
        status: 'pending_card' satisfies CheckoutStatus,
        clientSecret: intent.clientSecret,
        publishableKey: config.paymentEngine.publishableKey,
        amountCents: monthlyFeeCents,
        currency: 'USD',
      });
    }

    // ── USDC: open an x402 payment intent. ─────────────────────────────────────
    const x402 = await requestX402Payment(sessionId, tier.monthlyFee);
    if (!x402.ok) {
      await markSession(sessionId, { status: 'declined', failure_reason: x402.message });
      return reply.status(502).send({ sessionId, status: 'error' satisfies CheckoutStatus, message: 'USDC payment is temporarily unavailable. Try card, or try again shortly.' });
    }
    await db.query('public', `UPDATE checkout_sessions SET x402_receipt_id = $1, updated_at = NOW() WHERE id = $2`, [x402.receiptId, sessionId]);
    return reply.status(201).send({
      sessionId,
      status: 'pending_usdc' satisfies CheckoutStatus,
      depositId: x402.depositId,
      amountUnits: x402.amountUnits,
      chain: x402.chain,
      token: x402.token,
      expiresAt: x402.expiresAt,
    });
  });

  // ── GET /v1/checkout/sessions/:id — lightweight status read, no upstream call. ──
  app.get<{ Params: { id: string } }>('/v1/checkout/sessions/:id', async (req, reply) => {
    const session = await getSession(req.params.id);
    if (!session) return reply.status(404).send({ error: 'NotFound', message: 'No such checkout session.' });
    return reply.send({ sessionId: session.id, status: toCheckoutStatus(session), failureReason: session.failure_reason });
  });

  // ── POST /v1/checkout/sessions/:id/confirm — re-verify upstream, provision on success. ──
  app.post<{ Params: { id: string } }>('/v1/checkout/sessions/:id/confirm', async (req, reply) => {
    const session = await getSession(req.params.id);
    if (!session) return reply.status(404).send({ error: 'NotFound', message: 'No such checkout session.' });

    if (session.status !== 'pending') {
      // Already terminal — confirm is safe to call repeatedly (a client
      // retry, a double-click) and always returns the same settled answer.
      return reply.send({ sessionId: session.id, status: toCheckoutStatus(session), customerId: session.customer_id, failureReason: session.failure_reason });
    }

    if (new Date(session.expires_at).getTime() < Date.now()) {
      await markSession(session.id, { status: 'expired', failure_reason: 'Checkout session expired before payment was confirmed.' });
      return reply.send({ sessionId: session.id, status: 'expired' satisfies CheckoutStatus, message: 'This checkout session expired. Start again.' });
    }

    let paid = false;
    let declineReason: string | undefined;

    if (session.payment_method === 'card' && session.hyperswitch_payment_id) {
      const result = await getPayment(session.hyperswitch_payment_id);
      if (!result.ok) {
        // Upstream unreachable — visibly pending, never a silent hang or a false success.
        return reply.send({ sessionId: session.id, status: 'pending_card' satisfies CheckoutStatus, message: 'Still checking with the card processor — try again in a moment.' });
      }
      if (SUCCEEDED_STATUSES.has(result.status)) paid = true;
      else if (FAILED_STATUSES.has(result.status)) declineReason = `Card ${result.status}.`;
      else return reply.send({ sessionId: session.id, status: 'pending_card' satisfies CheckoutStatus, message: `Payment is ${result.status} — try again shortly.` });
    } else if (session.payment_method === 'usdc' && session.x402_receipt_id) {
      const result = await verifyX402Payment(session.x402_receipt_id);
      if (!result.ok) {
        return reply.send({ sessionId: session.id, status: 'pending_usdc' satisfies CheckoutStatus, message: 'Still checking on-chain — try again in a moment.' });
      }
      if (result.valid) paid = true;
      else return reply.send({ sessionId: session.id, status: 'pending_usdc' satisfies CheckoutStatus, message: `Not yet confirmed on-chain (${result.status}). This can take a few minutes.` });
    } else {
      return reply.status(400).send({ error: 'InvalidSession', message: 'Session has no payment method to confirm.' });
    }

    if (!paid) {
      await markSession(session.id, { status: 'declined', failure_reason: declineReason ?? 'Payment was declined.' });
      return reply.send({ sessionId: session.id, status: 'declined' satisfies CheckoutStatus, message: declineReason ?? 'Payment was declined.' });
    }

    try {
      const { customerId } = await provision(session);
      await markSession(session.id, { status: 'succeeded', customer_id: customerId });
      return reply.send({ sessionId: session.id, status: 'succeeded' satisfies CheckoutStatus, customerId });
    } catch (err) {
      // Money moved but provisioning failed — this is an operator-visible
      // gap (payment succeeded, no account yet), not something to paper over
      // with a fake success. Session stays 'pending' so a retry of confirm
      // tries provisioning again rather than re-charging.
      logger.error({ err, sessionId: session.id }, '[checkout] payment confirmed but provisioning failed');
      return reply.status(502).send({
        sessionId: session.id,
        status: 'error' satisfies CheckoutStatus,
        message: 'Payment succeeded but we could not finish setting up your account. Contact support with this session ID.',
      });
    }
  });
}

function toCheckoutStatus(session: CheckoutSessionRow): CheckoutStatus {
  switch (session.status) {
    case 'succeeded': return 'succeeded';
    case 'declined':  return 'declined';
    case 'stalled':   return 'stalled';
    case 'expired':   return 'expired';
    default:          return session.payment_method === 'usdc' ? 'pending_usdc' : 'pending_card';
  }
}

/**
 * Hyperswitch payment-engine client — outbound calls to create and read a
 * payment intent for card checkout.
 *
 * This is a genuine Hyperswitch fork (crates/router), so its real, documented
 * API shape applies: POST /payments creates a PaymentIntent and, left
 * unconfirmed (confirm: false, the default here), returns a client_secret.
 * The frontend loads Hyperswitch's own Web SDK against that client_secret and
 * collects the card directly into Hyperswitch's hosted widget — raw PAN never
 * reaches this service or the browser's own JS. This module never sees a card
 * number either; it only ever handles amounts, currency and status.
 *
 * Server-to-server auth is Hyperswitch's `api-key` header carrying the
 * merchant secret key (config.paymentEngine.apiKey) — never sent to the
 * browser. The browser instead gets config.paymentEngine.publishableKey,
 * which is safe by design (that's what "publishable" means in Hyperswitch's
 * own key model, same as Stripe's).
 */

import { config } from '../config.js';
import { logger } from './logger.js';

export interface CreatePaymentIntentInput {
  amountCents: number; // smallest currency unit, matching Hyperswitch's own convention
  currency: string;    // ISO 4217, e.g. "USD"
  description: string;
  /** Our own checkout_sessions.id, round-tripped via metadata for reconciliation. */
  sessionId: string;
  customerEmail: string;
}

export type CreatePaymentIntentResult =
  | { ok: true; paymentId: string; clientSecret: string; status: string }
  | { ok: false; reason: 'not_configured' | 'call_failed'; message: string };

export async function createPaymentIntent(
  input: CreatePaymentIntentInput,
): Promise<CreatePaymentIntentResult> {
  if (!config.paymentEngine.apiKey) {
    return { ok: false, reason: 'not_configured', message: 'PAYMENT_ENGINE_API_KEY is not set — card checkout is unavailable.' };
  }

  try {
    const res = await fetch(`${config.paymentEngine.baseUrl.replace(/\/$/, '')}/payments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key':      config.paymentEngine.apiKey,
      },
      body: JSON.stringify({
        amount:        input.amountCents,
        currency:      input.currency,
        confirm:       false,
        capture_method: 'automatic',
        description:   input.description,
        customer_email: input.customerEmail,
        metadata:      { forgepay_checkout_session_id: input.sessionId },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error({ status: res.status, body }, '[hyperswitch] payment intent creation failed');
      return { ok: false, reason: 'call_failed', message: `payment-engine /payments returned ${res.status}: ${body}` };
    }

    const data = (await res.json()) as { payment_id: string; client_secret: string; status: string };
    return { ok: true, paymentId: data.payment_id, clientSecret: data.client_secret, status: data.status };
  } catch (err) {
    logger.error({ err }, '[hyperswitch] payment intent creation call failed');
    return {
      ok: false,
      reason: 'call_failed',
      message: `payment-engine /payments call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export type GetPaymentResult =
  | { ok: true; status: string; amountCents: number; currency: string }
  | { ok: false; reason: 'not_configured' | 'call_failed'; message: string };

/**
 * Read a payment's authoritative status server-side. Never trust the
 * browser's own claim that a card payment succeeded — the frontend only ever
 * learns "the Hyperswitch widget returned success", which is evidence the
 * card was *submitted*, not that the charge cleared. This is what confirms it.
 */
export async function getPayment(paymentId: string): Promise<GetPaymentResult> {
  if (!config.paymentEngine.apiKey) {
    return { ok: false, reason: 'not_configured', message: 'PAYMENT_ENGINE_API_KEY is not set.' };
  }

  try {
    const res = await fetch(`${config.paymentEngine.baseUrl.replace(/\/$/, '')}/payments/${paymentId}`, {
      headers: { 'api-key': config.paymentEngine.apiKey },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, reason: 'call_failed', message: `payment-engine GET /payments/${paymentId} returned ${res.status}: ${body}` };
    }

    const data = (await res.json()) as { status: string; amount: number; currency: string };
    return { ok: true, status: data.status, amountCents: data.amount, currency: data.currency };
  } catch (err) {
    return {
      ok: false,
      reason: 'call_failed',
      message: `payment-engine GET /payments/${paymentId} call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Hyperswitch statuses that mean the charge actually cleared. */
export const SUCCEEDED_STATUSES = new Set(['succeeded', 'partially_captured']);
/** Statuses that mean it's done and it failed — safe to tell the customer "declined". */
export const FAILED_STATUSES = new Set(['failed', 'cancelled']);

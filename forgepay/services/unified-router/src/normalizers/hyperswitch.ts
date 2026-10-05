/**
 * Hyperswitch → ForgePay canonical event normalizer
 *
 * Maps Hyperswitch webhook payloads to the canonical ForgePayEvent schema.
 *
 * Shape, from this repo's own Hyperswitch source (the fork at the root):
 *   OutgoingWebhook { merchant_id, event_id, event_type, content, timestamp }
 *     crates/api_models/src/webhooks.rs
 *   event_type is snake_case (`payment_succeeded`, `refund_succeeded`, …)
 *     crates/common_enums/src/enums.rs — EventType, rename_all = "snake_case"
 *   content is `{ type: 'payment_details' | 'refund_details' | 'dispute_details' | …, object }`
 *
 * This used to match Stripe-style dotted names (`payment_intent.succeeded`),
 * which Hyperswitch never sends, so every real webhook was dropped.
 */

import type { ForgePayEvent, EventType, PaymentEventData } from '../types/events.js';

interface HyperswitchWebhook {
  event_id?:    string;
  event_type?:  string;
  content?: {
    type?: string;
    object?: {
      payment_id?:     string;
      refund_id?:      string;
      dispute_id?:     string;
      // A number (MinorUnit) for payments and refunds; a string
      // (StringMinorUnit) for disputes.
      amount?:         number | string;
      currency?:       string;
      status?:         string;
      customer_id?:    string;
      payment_method?: string;
      error_message?:  string;
      metadata?:       Record<string, string>;
    };
  };
  merchant_id?: string;
  timestamp?:   string;
}

const STATUS_MAP: Record<string, PaymentEventData['status']> = {
  requires_payment_method: 'created',
  requires_confirmation:   'created',
  requires_action:         'processing',
  processing:              'processing',
  succeeded:               'succeeded',
  failed:                  'failed',
  cancelled:               'cancelled',
  partially_captured:      'succeeded',
  refunded:                'refunded',
};

// Hyperswitch EventType (snake_case) → canonical type. Events with no
// canonical equivalent (mandates, payouts, refund_failed, later dispute
// stages, …) are ignored rather than mislabelled.
const EVENT_TYPE_MAP: Record<string, EventType> = {
  payment_processing:  'payment.processing',
  payment_authorized:  'payment.processing',
  action_required:     'payment.processing',
  payment_succeeded:   'payment.succeeded',
  payment_captured:    'payment.succeeded',
  payment_failed:      'payment.failed',
  payment_cancelled:   'payment.cancelled',
  payment_expired:     'payment.cancelled',
  refund_succeeded:    'payment.refunded',
  dispute_opened:      'payment.disputed',
};

// The status a canonical event implies. Refund and dispute objects carry
// their own status vocabularies, so the payment status is taken from the
// event rather than from `object.status`.
const STATUS_FOR_EVENT: Partial<Record<EventType, PaymentEventData['status']>> = {
  'payment.refunded': 'refunded',
};

// ISO 4217 currencies with no minor unit: 1 JPY is sent as 1, not 100.
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

export function normalizeHyperswitchEvent(
  body: Record<string, unknown>,
): ForgePayEvent | null {
  const payload = body as HyperswitchWebhook;
  const eventType = EVENT_TYPE_MAP[payload.event_type ?? ''];

  if (!eventType) {
    // Unrecognized event type from Hyperswitch — safe to ignore
    return null;
  }

  const obj = payload.content?.object ?? {};

  const data: PaymentEventData = {
    paymentId:      obj.payment_id ?? '',
    amount: {
      // NOTE: Hyperswitch (and Stripe) represent amounts as integers in the smallest
      // currency unit — cents for USD/EUR, pence for GBP, sen for JPY is an exception
      // (JPY has no sub-unit so 1 JPY is stored as 1, not 100).
      // We normalise to a human-readable decimal string ("49.00") for all downstream
      // consumers. Never store floating point for currency — use Decimal or integer cents.
      value:    formatMinor(obj.amount, obj.currency),
      currency: obj.currency ?? 'USD',
    },
    status:         STATUS_FOR_EVENT[eventType] ?? STATUS_MAP[obj.status ?? ''] ?? 'created',
    paymentMethod:  mapPaymentMethod(obj.payment_method),
    customerId:     obj.customer_id,
    failureReason:  obj.error_message,
    metadata:       obj.metadata,
  };

  return {
    id:            crypto.randomUUID(),
    type:          eventType,
    source:        'payment-engine',
    merchantId:    payload.merchant_id ?? '',
    occurredAt:    toIso(payload.timestamp) ?? new Date().toISOString(),
    processedAt:   new Date().toISOString(),
    data,
    rawPayload:    body,
    sourceEventId: payload.event_id ?? '',
    apiVersion:    '2026-04',
  };
}

function formatMinor(amount: number | string | undefined, currency?: string): string {
  const minor = typeof amount === 'string' ? Number(amount) : amount;
  if (minor == null || !Number.isFinite(minor)) return '0.00';
  return ZERO_DECIMAL.has((currency ?? '').toUpperCase()) ? minor.toFixed(0) : (minor / 100).toFixed(2);
}

// Hyperswitch serialises PrimitiveDateTime without a zone; it is UTC.
function toIso(ts?: string): string | undefined {
  if (!ts) return undefined;
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : `${ts}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function mapPaymentMethod(method?: string): PaymentEventData['paymentMethod'] {
  if (!method) return 'card';
  if (method.includes('bank') || method === 'ach' || method === 'sepa') return 'bank_transfer';
  if (method.includes('wallet') || method === 'paypal') return 'wallet';
  return 'card';
}

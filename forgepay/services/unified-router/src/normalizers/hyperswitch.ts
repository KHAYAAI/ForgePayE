/**
 * Hyperswitch → ForgePay canonical event normalizer
 *
 * Maps Hyperswitch webhook payloads to the canonical ForgePayEvent schema.
 * Reference: https://api-reference.hyperswitch.io/#tag/webhooks
 */

import type { ForgePayEvent, EventType, PaymentEventData } from '../types/events.js';

interface HyperswitchWebhook {
  event_id?:    string;
  event_type?:  string;
  content?: {
    object?: {
      payment_id?:     string;
      amount?:         number;
      currency?:       string;
      status?:         string;
      customer_id?:    string;
      payment_method?: string;
      error_message?:  string;
      metadata?:       Record<string, string>;
    };
  };
  merchant_id?: string;
  created?:     string;
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

const EVENT_TYPE_MAP: Record<string, EventType> = {
  payment_intent.created:    'payment.created',
  payment_intent.processing: 'payment.processing',
  payment_intent.succeeded:  'payment.succeeded',
  payment_intent.failed:     'payment.failed',
  payment_intent.cancelled:  'payment.cancelled',
  refund.succeeded:          'payment.refunded',
  dispute.opened:            'payment.disputed',
};

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
      // Hyperswitch sends amounts in smallest currency unit (cents)
      value:    obj.amount != null ? (obj.amount / 100).toFixed(2) : '0.00',
      currency: obj.currency ?? 'USD',
    },
    status:         STATUS_MAP[obj.status ?? ''] ?? 'created',
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
    occurredAt:    payload.created ?? new Date().toISOString(),
    processedAt:   new Date().toISOString(),
    data,
    rawPayload:    body,
    sourceEventId: payload.event_id ?? '',
    apiVersion:    '2026-04',
  };
}

function mapPaymentMethod(method?: string): PaymentEventData['paymentMethod'] {
  if (!method) return 'card';
  if (method.includes('bank') || method === 'ach' || method === 'sepa') return 'bank_transfer';
  if (method.includes('wallet') || method === 'paypal') return 'wallet';
  return 'card';
}

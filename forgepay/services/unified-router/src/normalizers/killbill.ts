/**
 * Kill Bill → ForgePay canonical event normalizer
 *
 * Maps Kill Bill notification payloads to ForgePayEvent.
 * Fetches enrichment data (planId, amount, currentPeriodEnd) from the Kill Bill
 * API when the notification body doesn't include it.
 */

import type { ForgePayEvent, EventType, SubscriptionEventData, InvoiceEventData } from '../types/events.js';
import { fetchSubscription, fetchInvoice } from '../lib/killbill-client.js';

interface KillBillNotification {
  eventType?:      string;
  accountId?:      string;
  tenantId?:       string;          // maps to merchantId
  subscriptionId?: string;
  bundleId?:       string;
  invoiceId?:      string;
  userToken?:      string;          // idempotency token
  metaData?:       string;
  eventDate?:      string;
}

const EVENT_TYPE_MAP: Partial<Record<string, EventType>> = {
  SUBSCRIPTION_CREATION:      'subscription.created',
  SUBSCRIPTION_PHASE:         'subscription.renewed',
  SUBSCRIPTION_CANCEL:        'subscription.cancelled',
  PAYMENT_FAILED:             'invoice.payment_failed',
  INVOICE_CREATION:           'invoice.created',
  INVOICE_ADJUSTMENT:         'invoice.created',
  PAYMENT_SUCCESS:            'invoice.paid',
  OVERDUE_CHANGE:             'subscription.past_due',
};

export async function normalizeKillBillEvent(
  body: Record<string, unknown>,
): Promise<ForgePayEvent | null> {
  const payload  = body as KillBillNotification;
  const eventType = EVENT_TYPE_MAP[payload.eventType ?? ''];

  if (!eventType) return null;

  // Kill Bill uses tenantId as the per-merchant API key
  const tenantApiKey = payload.tenantId ?? '';

  let data: SubscriptionEventData | InvoiceEventData;

  if (eventType.startsWith('subscription.')) {
    // Enrich with Kill Bill subscription API (planName, chargedThroughDate)
    const sub = payload.subscriptionId
      ? await fetchSubscription(payload.subscriptionId, tenantApiKey)
      : null;

    data = {
      subscriptionId:     payload.subscriptionId ?? '',
      customerId:         payload.accountId ?? '',
      planId:             sub?.planName ?? '',
      status:             mapSubscriptionStatus(eventType),
      currentPeriodStart: payload.eventDate ?? new Date().toISOString(),
      currentPeriodEnd:   sub?.chargedThroughDate ?? '',
    } satisfies SubscriptionEventData;
  } else {
    // Enrich with Kill Bill invoice API (amount, currency)
    const invoice = payload.invoiceId
      ? await fetchInvoice(payload.invoiceId, tenantApiKey)
      : null;

    data = {
      invoiceId:  payload.invoiceId ?? '',
      customerId: payload.accountId ?? '',
      amount: {
        value:    invoice ? invoice.amount.toFixed(2) : '0.00',
        currency: invoice?.currency ?? 'USD',
      },
      status: mapInvoiceStatus(eventType),
    } satisfies InvoiceEventData;
  }

  return {
    id:            crypto.randomUUID(),
    type:          eventType,
    source:        'billing-engine',
    merchantId:    payload.tenantId ?? '',
    occurredAt:    payload.eventDate ?? new Date().toISOString(),
    processedAt:   new Date().toISOString(),
    data,
    rawPayload:    body,
    sourceEventId: payload.userToken ?? `${payload.tenantId}:${payload.eventType}:${payload.eventDate}`,
    apiVersion:    '2026-04',
  };
}

function mapSubscriptionStatus(eventType: EventType): string {
  const map: Partial<Record<EventType, string>> = {
    'subscription.created':   'active',
    'subscription.renewed':   'active',
    'subscription.cancelled': 'cancelled',
    'subscription.past_due':  'past_due',
  };
  return map[eventType] ?? 'unknown';
}

function mapInvoiceStatus(eventType: EventType): InvoiceEventData['status'] {
  if (eventType === 'invoice.paid') return 'paid';
  if (eventType === 'invoice.payment_failed') return 'open';
  return 'open';
}

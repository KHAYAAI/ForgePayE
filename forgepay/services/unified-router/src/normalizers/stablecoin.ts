/**
 * Stablecoin Gateway (ZeroPay fork) → ForgePay canonical event normalizer
 */

import type { ForgePayEvent, EventType, CryptoPaymentEventData } from '../types/events.js';

interface ZeroPayEvent {
  id?:           string;
  event?:        string;
  merchant_id?:  string;
  payment?: {
    id?:             string;
    amount?:         string;
    currency?:       string;
    chain?:          string;
    status?:         string;
    wallet_address?: string;
    tx_hash?:        string;
    confirmations?:  number;
    expires_at?:     string;
    fiat_amount?:    string;
    fiat_currency?:  string;
  };
  created_at?: string;
}

const EVENT_TYPE_MAP: Record<string, EventType> = {
  'payment.created':   'crypto_payment.created',
  'payment.confirmed': 'crypto_payment.confirmed',
  'payment.expired':   'crypto_payment.expired',
  'payment.underpaid': 'crypto_payment.underpaid',
};

export function normalizeStablecoinEvent(
  body: Record<string, unknown>,
): ForgePayEvent | null {
  const payload = body as ZeroPayEvent;
  const eventType = EVENT_TYPE_MAP[payload.event ?? ''];

  if (!eventType) return null;

  const p = payload.payment ?? {};

  const data: CryptoPaymentEventData = {
    paymentId: p.id ?? '',
    amount: {
      value:    p.amount ?? '0',
      currency: p.currency ?? 'USDC',
      chain:    p.chain,
    },
    fiatEquivalent: p.fiat_amount
      ? { value: p.fiat_amount, currency: p.fiat_currency ?? 'USD' }
      : undefined,
    status:        mapStatus(p.status, eventType),
    chain:         p.chain ?? '',
    txHash:        p.tx_hash,
    confirmations: p.confirmations,
    walletAddress: p.wallet_address ?? '',
    expiresAt:     p.expires_at,
  };

  return {
    id:            crypto.randomUUID(),
    type:          eventType,
    source:        'stablecoin-gateway',
    merchantId:    payload.merchant_id ?? '',
    occurredAt:    payload.created_at ?? new Date().toISOString(),
    processedAt:   new Date().toISOString(),
    data,
    rawPayload:    body,
    sourceEventId: payload.id ?? '',
    apiVersion:    '2026-04',
  };
}

function mapStatus(
  status: string | undefined,
  eventType: EventType,
): CryptoPaymentEventData['status'] {
  if (eventType === 'crypto_payment.confirmed') return 'confirmed';
  if (eventType === 'crypto_payment.expired')   return 'expired';
  if (eventType === 'crypto_payment.underpaid') return 'underpaid';
  return 'created';
}

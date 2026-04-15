/**
 * Crypto Gateway (Keagate fork) → ForgePay canonical event normalizer
 */

import type { ForgePayEvent, EventType, CryptoPaymentEventData } from '../types/events.js';

interface KeagateEvent {
  id?:          string;
  event_type?:  string;
  merchant_id?: string;
  invoice?: {
    id?:            string;
    coin?:          string;          // e.g. "BTC", "ETH", "LTC"
    amount?:        string;
    address?:       string;
    tx_hash?:       string;
    confirmations?: number;
    required_confirmations?: number;
    status?:        string;
    expires_at?:    string;
    usd_equivalent?: string;
  };
  timestamp?: string;
}

const EVENT_TYPE_MAP: Record<string, EventType> = {
  invoice_created:   'crypto_payment.created',
  payment_confirmed: 'crypto_payment.confirmed',
  invoice_expired:   'crypto_payment.expired',
  payment_underpaid: 'crypto_payment.underpaid',
};

export function normalizeCryptoEvent(
  body: Record<string, unknown>,
): ForgePayEvent | null {
  const payload = body as KeagateEvent;
  const eventType = EVENT_TYPE_MAP[payload.event_type ?? ''];

  if (!eventType) return null;

  const inv = payload.invoice ?? {};

  const data: CryptoPaymentEventData = {
    paymentId: inv.id ?? '',
    amount: {
      value:    inv.amount ?? '0',
      currency: inv.coin ?? 'BTC',
    },
    fiatEquivalent: inv.usd_equivalent
      ? { value: inv.usd_equivalent, currency: 'USD' }
      : undefined,
    status:        mapStatus(eventType),
    chain:         coinToChain(inv.coin),
    txHash:        inv.tx_hash,
    confirmations: inv.confirmations,
    walletAddress: inv.address ?? '',
    expiresAt:     inv.expires_at,
  };

  return {
    id:            crypto.randomUUID(),
    type:          eventType,
    source:        'crypto-gateway',
    merchantId:    payload.merchant_id ?? '',
    occurredAt:    payload.timestamp ?? new Date().toISOString(),
    processedAt:   new Date().toISOString(),
    data,
    rawPayload:    body,
    sourceEventId: payload.id ?? '',
    apiVersion:    '2026-04',
  };
}

function mapStatus(eventType: EventType): CryptoPaymentEventData['status'] {
  if (eventType === 'crypto_payment.confirmed') return 'confirmed';
  if (eventType === 'crypto_payment.expired')   return 'expired';
  if (eventType === 'crypto_payment.underpaid') return 'underpaid';
  return 'created';
}

function coinToChain(coin?: string): string {
  const chainMap: Record<string, string> = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    LTC: 'litecoin',
    SOL: 'solana',
    XMR: 'monero',
    DOGE: 'dogecoin',
    XRP: 'ripple',
  };
  return chainMap[coin?.toUpperCase() ?? ''] ?? coin?.toLowerCase() ?? 'unknown';
}

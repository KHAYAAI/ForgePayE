import { createHmac } from 'node:crypto';
import { config } from '../config.js';

export interface CryptoPaymentEvent {
  eventId:    string;
  type:       'crypto.payment.received' | 'crypto.payment.confirmed' | 'crypto.payment.expired';
  merchantId: string;
  invoiceId:  string;
  coin:       string;
  amountCrypto: string;
  amountUsd:  number;
  txId?:      string;
  toAddress:  string;
  occurredAt: string;
}

export async function forwardToUnifiedRouter(event: CryptoPaymentEvent): Promise<void> {
  const body      = JSON.stringify(event);
  const signature = createHmac('sha256', config.internalWebhookSecret).update(body).digest('hex');

  try {
    const res = await fetch(`${config.unifiedRouterUrl}/webhooks/crypto`, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-forgepay-sig':    `sha256=${signature}`,
        'x-forgepay-source': 'crypto-gateway',
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) console.error('Failed to forward crypto event:', res.status);
  } catch (err) {
    console.error('Error forwarding crypto event:', err);
  }
}

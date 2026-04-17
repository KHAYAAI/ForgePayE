/**
 * Forward canonical stablecoin payment events to the unified-router.
 * The unified-router then fans them out to merchant webhook endpoints.
 */

import { createHmac } from 'node:crypto';
import { config } from '../config.js';

export interface StablecoinPaymentEvent {
  eventId:     string;
  type:        'stablecoin.payment.received' | 'stablecoin.payment.confirmed' | 'stablecoin.payment.expired';
  merchantId:  string;
  depositId:   string;
  chain:       string;
  token:       'USDC' | 'USDT';
  amountUnits: string;   // token units (USDC/USDT have 6 decimals)
  amountUsd:   number;   // human-readable USD value
  txHash?:     string;
  fromAddress?: string;
  toAddress:   string;
  confirmedAt?: string;
  occurredAt:  string;
}

export async function forwardToUnifiedRouter(event: StablecoinPaymentEvent): Promise<void> {
  const body      = JSON.stringify(event);
  const signature = createHmac('sha256', config.internalWebhookSecret).update(body).digest('hex');

  try {
    const res = await fetch(`${config.unifiedRouterUrl}/webhooks/stablecoin`, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'x-forgepay-sig':   `sha256=${signature}`,
        'x-forgepay-source': 'stablecoin-gateway',
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.error('Failed to forward stablecoin event to unified-router:', res.status);
    }
  } catch (err) {
    console.error('Error forwarding stablecoin event:', err);
  }
}

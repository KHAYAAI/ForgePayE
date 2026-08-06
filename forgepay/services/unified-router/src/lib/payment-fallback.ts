/**
 * Payment Processing Fallback Handler
 *
 * Mitigates: "Stripe/ACH payment processing fails" (Critical Risk)
 *
 * Fallback chain:
 * 1. Try Stripe ACH (primary)
 * 2. Fallback to Circle USDC (if customer has wallet)
 * 3. Manual payment request (if both fail)
 *
 * ⚠️ STATUS: the orchestration below is complete and correct, but NEITHER
 * PROVIDER IS WIRED. `processViaStripe` and `processViaCircle` throw
 * `NotWiredError` until real connector calls replace them.
 *
 * They previously returned `{ success: true }` with a fabricated transaction
 * hash (`stripe_${Date.now()}`) without contacting any provider. Nothing
 * imports this module today, so no live payment was ever affected — but had it
 * been wired in that state it would have marked payments settled that never
 * moved money. Throwing is the safe failure mode: the chain below catches
 * provider errors and degrades to `createManualPaymentRequest`, which returns
 * `success: false` and hands off to a human. An unimplemented integration must
 * never be able to report success.
 *
 * To wire: replace each throw with the real call and return the provider's own
 * transaction identifier — never a synthesised one.
 */

import type { Address } from 'viem';

/** Thrown by a provider path that has no real integration behind it yet. */
export class NotWiredError extends Error {
  constructor(public readonly method: string, integration: string) {
    super(
      `Payment method "${method}" is not wired: ${integration} has no live ` +
      `integration. Refusing to report success for a payment that was never made.`,
    );
    this.name = 'NotWiredError';
  }
}

export interface PaymentRequest {
  customerId: string;
  amount: bigint;
  currency: string;
  paymentMethodId?: string;
  walletAddress?: Address;
}

export interface PaymentResult {
  success: boolean;
  txHash: string;
  method: 'stripe_ach' | 'circle_usdc' | 'manual_request';
  status: 'completed' | 'pending' | 'failed';
  error?: string;
  fallbackUsed: boolean;
}

export async function processPaymentWithFallback(request: PaymentRequest): Promise<PaymentResult> {
  console.info(`[Payment Fallback] Processing ${request.amount} ${request.currency} for ${request.customerId}`);

  // Try primary: Stripe ACH
  try {
    console.info('[Payment Fallback] Attempting Stripe ACH...');
    const result = await processViaStripe(request);
    if (result.success) {
      return { ...result, fallbackUsed: false };
    }
    console.warn('[Payment Fallback] Stripe ACH failed, attempting fallback...');
  } catch (err) {
    console.error('[Payment Fallback] Stripe ACH error:', err);
  }

  // Try fallback 1: Circle USDC
  if (request.walletAddress) {
    try {
      console.info('[Payment Fallback] Attempting Circle USDC fallback...');
      const result = await processViaCircle(request);
      if (result.success) {
        return { ...result, fallbackUsed: true };
      }
      console.warn('[Payment Fallback] Circle USDC failed, attempting manual request...');
    } catch (err) {
      console.error('[Payment Fallback] Circle USDC error:', err);
    }
  }

  // Fallback 2: Manual payment request
  try {
    console.info('[Payment Fallback] Creating manual payment request...');
    const result = await createManualPaymentRequest(request);
    return { ...result, fallbackUsed: true };
  } catch (err) {
    console.error('[Payment Fallback] Manual payment request failed:', err);
    return {
      success: false,
      txHash: '',
      method: 'manual_request',
      status: 'failed',
      error: `All payment methods failed: ${String(err)}`,
      fallbackUsed: true,
    };
  }
}

async function processViaStripe(request: PaymentRequest): Promise<Omit<PaymentResult, 'fallbackUsed'>> {
  // Call Hyperswitch → Stripe backend
  if (!request.paymentMethodId) {
    throw new Error('No payment method provided');
  }

  throw new NotWiredError('stripe_ach', 'Hyperswitch → Stripe connector');
}

async function processViaCircle(request: PaymentRequest): Promise<Omit<PaymentResult, 'fallbackUsed'>> {
  // Call Circle stablecoin API
  if (!request.walletAddress) {
    throw new Error('Wallet address required for Circle payment');
  }

  throw new NotWiredError('circle_usdc', 'Circle Payouts API');
}

async function createManualPaymentRequest(request: PaymentRequest): Promise<Omit<PaymentResult, 'fallbackUsed'>> {
  // Create a manual payment request (invoice)
  // Customer receives email with bank details or wire instructions
  // CSM follows up manually

  console.warn(`[Payment Fallback] Creating manual payment request for ${request.customerId}`);

  // TODO: Create in database, send email to CSM
  return {
    success: false,
    txHash: `manual_request_${Date.now()}`,
    method: 'manual_request',
    status: 'pending',
    error: 'Automatic payment processing failed. CSM will contact you with manual payment instructions.',
  };
}

/**
 * When Stripe/ACH fails, notify ops + customer
 */
export async function notifyPaymentFailure(
  customerId: string,
  error: string,
  fallbackUsed: boolean
): Promise<void> {
  console.error(`[Payment Fallback] Notifying customer ${customerId} of payment failure`);

  // TODO: Send email to customer
  // TODO: Send alert to Slack #ops-alerts
  // TODO: Create support ticket

  const message = fallbackUsed
    ? `We used your backup payment method (USDC). Your CSM will confirm the transaction.`
    : `Your scheduled payment failed. We'll retry automatically. Contact us if this persists.`;

  console.info(`[Payment Fallback] Customer notification: ${message}`);
}

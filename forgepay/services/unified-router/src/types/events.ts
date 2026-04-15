/**
 * ForgePay Canonical Event Schema
 *
 * All events from every sub-service are normalized into this shape before
 * being stored, forwarded to merchants, and published to the event stream.
 */

export type EventSource =
  | 'payment-engine'
  | 'billing-engine'
  | 'mor-layer'
  | 'stablecoin-gateway'
  | 'crypto-gateway';

export type EventType =
  // Payment events
  | 'payment.created'
  | 'payment.processing'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.cancelled'
  | 'payment.refunded'
  | 'payment.disputed'
  // Stablecoin / crypto
  | 'crypto_payment.created'
  | 'crypto_payment.confirmed'
  | 'crypto_payment.expired'
  | 'crypto_payment.underpaid'
  // Subscription billing
  | 'subscription.created'
  | 'subscription.renewed'
  | 'subscription.cancelled'
  | 'subscription.past_due'
  | 'subscription.trial_ending'
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  // Tax / MoR
  | 'tax.calculated'
  | 'tax.remitted'
  // Customer
  | 'customer.created'
  | 'customer.updated';

/** Amounts are always stored as strings to avoid floating-point issues */
export interface MoneyAmount {
  value:    string;    // e.g. "49.00"
  currency: string;    // ISO 4217 or coin symbol e.g. "USD", "USDC", "BTC"
  chain?:   string;    // Blockchain chain for crypto, e.g. "base", "ethereum"
}

export interface ForgePayEvent {
  /** Globally unique event ID — UUID v4 */
  id: string;

  /** The type of event */
  type: EventType;

  /** Which sub-service emitted this event */
  source: EventSource;

  /** Merchant ID — used for tenant routing */
  merchantId: string;

  /** ISO 8601 timestamp when the event occurred */
  occurredAt: string;

  /** ISO 8601 timestamp when we received and processed it */
  processedAt: string;

  /** The canonical payload — shape varies per event type */
  data: PaymentEventData | CryptoPaymentEventData | SubscriptionEventData | InvoiceEventData | Record<string, unknown>;

  /** Raw body from the source (for debugging / replay) */
  rawPayload: Record<string, unknown>;

  /** Idempotency — source event ID for dedup */
  sourceEventId: string;

  /** API version this event was generated under */
  apiVersion: '2026-04';
}

export interface PaymentEventData {
  paymentId:       string;
  amount:          MoneyAmount;
  status:          'created' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'refunded';
  paymentMethod:   'card' | 'bank_transfer' | 'wallet';
  customerId?:     string;
  orderId?:        string;
  processorId?:    string;   // upstream payment processor ID
  failureReason?:  string;
  metadata?:       Record<string, string>;
}

export interface CryptoPaymentEventData {
  paymentId:       string;
  amount:          MoneyAmount;
  fiatEquivalent?: MoneyAmount;
  status:          'created' | 'confirmed' | 'expired' | 'underpaid';
  chain:           string;
  txHash?:         string;
  confirmations?:  number;
  walletAddress:   string;
  expiresAt?:      string;
}

export interface SubscriptionEventData {
  subscriptionId:  string;
  customerId:      string;
  planId:          string;
  status:          string;
  currentPeriodStart: string;
  currentPeriodEnd:   string;
  cancelAtPeriodEnd?: boolean;
}

export interface InvoiceEventData {
  invoiceId:    string;
  customerId:   string;
  amount:       MoneyAmount;
  status:       'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  dueDate?:     string;
  paidAt?:      string;
}

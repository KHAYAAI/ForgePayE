/**
 * ForgePay SDK — Canonical TypeScript types.
 * Generated from the ForgePay OpenAPI 3.1 specification.
 * API Version: 2026-04
 */

// ── Common ────────────────────────────────────────────────────────────────────

export type Currency      = string;  // ISO 4217: "USD", "EUR", "GBP"
export type CryptoCoin    = 'BTC' | 'ETH' | 'LTC' | 'XMR' | 'DOGE' | 'SOL' | 'XRP' | string;
export type StableCoin    = 'USDC' | 'USDT' | 'EURC';
export type Chain         = 'ethereum' | 'base' | 'polygon' | 'arbitrum' | 'solana' | string;
export type ApiVersion    = '2026-04';

export interface FPError {
  code:    string;
  message: string;
  param?:  string;
  type:    'api_error' | 'invalid_request' | 'authentication_error' | 'rate_limit_error';
}

export interface ListResponse<T> {
  data:       T[];
  count:      number;
  total:      number;
  has_more:   boolean;
  next_cursor?: string;
}

// ── Payments ──────────────────────────────────────────────────────────────────

export type PaymentStatus =
  | 'created'
  | 'processing'
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded';

export type PaymentMethodType =
  | 'card'
  | 'bank_transfer'
  | 'wallet'
  | 'usdc'
  | 'usdt'
  | 'crypto';

export interface Payment {
  id:                    string;
  object:                'payment';
  amount:                number;        // in smallest currency unit (cents)
  currency:              Currency;
  status:                PaymentStatus;
  payment_method_type:   PaymentMethodType;
  customer_id:           string | null;
  description:           string | null;
  client_secret:         string | null; // for frontend confirmation
  metadata:              Record<string, string>;
  created:               number;        // Unix timestamp
  error?:                { code: string; message: string };
}

export interface PaymentCreateParams {
  amount:              number;          // cents
  currency:            Currency;
  payment_method_type?: PaymentMethodType;
  customer_id?:        string;
  description?:        string;
  confirm?:            boolean;         // confirm immediately (server-side only)
  return_url?:         string;
  metadata?:           Record<string, string>;
  idempotency_key?:    string;
}

export interface RefundCreateParams {
  payment_id:  string;
  amount?:     number;                  // omit for full refund
  reason?:     'duplicate' | 'fraudulent' | 'requested_by_customer';
  metadata?:   Record<string, string>;
}

export interface Refund {
  id:         string;
  object:     'refund';
  payment_id: string;
  amount:     number;
  currency:   Currency;
  status:     'pending' | 'succeeded' | 'failed';
  reason:     string | null;
  created:    number;
}

// ── Customers ─────────────────────────────────────────────────────────────────

export interface Customer {
  id:          string;
  object:      'customer';
  email:       string | null;
  name:        string | null;
  phone:       string | null;
  description: string | null;
  metadata:    Record<string, string>;
  created:     number;
}

export interface CustomerCreateParams {
  email?:       string;
  name?:        string;
  phone?:       string;
  description?: string;
  metadata?:    Record<string, string>;
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'unpaid'
  | 'paused';

export interface Subscription {
  id:                     string;
  object:                 'subscription';
  customer_id:            string;
  plan_id:                string;
  status:                 SubscriptionStatus;
  current_period_start:   number;   // Unix timestamp
  current_period_end:     number;
  trial_end:              number | null;
  cancel_at_period_end:   boolean;
  cancelled_at:           number | null;
  metadata:               Record<string, string>;
  created:                number;
}

export interface SubscriptionCreateParams {
  customer_id:       string;
  plan_id:           string;
  trial_days?:       number;
  payment_method_id?: string;
  metadata?:         Record<string, string>;
  idempotency_key?:  string;
}

export interface SubscriptionUpdateParams {
  plan_id?:              string;
  cancel_at_period_end?: boolean;
  metadata?:             Record<string, string>;
}

// ── Plans ─────────────────────────────────────────────────────────────────────

export interface Plan {
  id:               string;
  object:           'plan';
  name:             string;
  amount:           number;
  currency:         Currency;
  interval:         'month' | 'year' | 'week' | 'day';
  interval_count:   number;
  trial_period_days: number | null;
  active:           boolean;
  metadata:         Record<string, string>;
}

// ── Usage metering ─────────────────────────────────────────────────────────────

export interface UsageRecord {
  id:              string;
  object:          'usage_record';
  subscription_id: string;
  quantity:        number;
  timestamp:       number;
  action:          'increment' | 'set';
}

export interface UsageRecordCreateParams {
  subscription_id: string;
  quantity:        number;
  timestamp?:      Date | number;
  action?:         'increment' | 'set';
  idempotency_key?: string;
}

// ── Stablecoin payments ───────────────────────────────────────────────────────

export type StablecoinPaymentStatus =
  | 'pending'
  | 'confirmed'
  | 'expired'
  | 'underpaid'
  | 'failed';

export interface StablecoinPayment {
  id:               string;
  object:           'stablecoin_payment';
  amount:           string;           // decimal string, e.g. "49.00"
  currency:         StableCoin;
  chain:            Chain;
  wallet_address:   string;
  tx_hash:          string | null;
  confirmations:    number;
  status:           StablecoinPaymentStatus;
  customer_id:      string | null;
  fiat_equivalent:  { amount: string; currency: Currency } | null;
  expires_at:       number;
  metadata:         Record<string, string>;
  created:          number;
}

export interface StablecoinPaymentCreateParams {
  amount:      string;               // decimal string: "49.00"
  currency:    StableCoin;
  chain:       Chain;
  customer_id?: string;
  metadata?:   Record<string, string>;
  idempotency_key?: string;
}

// ── Crypto payments ───────────────────────────────────────────────────────────

export interface CryptoPayment {
  id:               string;
  object:           'crypto_payment';
  coin:             CryptoCoin;
  amount:           string;           // decimal in coin units, e.g. "0.00102"
  address:          string;
  tx_hash:          string | null;
  confirmations:    number;
  required_confirmations: number;
  status:           StablecoinPaymentStatus;
  customer_id:      string | null;
  usd_equivalent:   string | null;
  expires_at:       number;
  qr_code_url:      string | null;
  metadata:         Record<string, string>;
  created:          number;
}

export interface CryptoPaymentCreateParams {
  coin:         CryptoCoin;
  amount_usd:   string;              // amount in USD, converted to coin at current rate
  customer_id?: string;
  expires_in?:  number;              // seconds, default 900 (15 min)
  metadata?:    Record<string, string>;
  idempotency_key?: string;
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

export interface WebhookEndpoint {
  id:              string;
  object:          'webhook_endpoint';
  url:             string;
  enabled_events:  string[];
  status:          'enabled' | 'disabled';
  created:         number;
}

export interface WebhookEndpointCreateParams {
  url:             string;
  enabled_events:  string[];         // e.g. ["payment.succeeded", "subscription.created"]
  metadata?:       Record<string, string>;
}

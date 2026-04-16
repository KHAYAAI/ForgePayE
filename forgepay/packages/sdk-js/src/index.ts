/**
 * @forgepay/sdk — Official JavaScript / TypeScript SDK
 *
 * @example
 * ```ts
 * import { ForgePay } from '@forgepay/sdk';
 *
 * const fp = new ForgePay({ apiKey: process.env.FORGEPAY_API_KEY! });
 *
 * // Accept a card payment
 * const payment = await fp.payments.create({
 *   amount: 4900,
 *   currency: 'USD',
 *   customer_id: 'cus_123',
 *   idempotency_key: 'order_001',
 * });
 *
 * // Accept USDC on Base
 * const stable = await fp.stablecoins.create({
 *   amount: '49.00',
 *   currency: 'USDC',
 *   chain: 'base',
 * });
 *
 * // Create a subscription
 * const sub = await fp.subscriptions.create({
 *   customer_id: 'cus_123',
 *   plan_id: 'forgepay-growth-monthly',
 *   trial_days: 14,
 * });
 *
 * // Report AI token usage
 * await fp.usage.report({
 *   subscription_id: sub.id,
 *   quantity: 150_000,
 *   timestamp: new Date(),
 * });
 * ```
 *
 * @packageDocumentation
 */

export { ForgePay } from './forgepay.js';
export type { FPClientOptions } from './client.js';

// Re-export all types for easy consumer access
export type {
  Payment,
  PaymentCreateParams,
  PaymentStatus,
  PaymentMethodType,
  Refund,
  RefundCreateParams,
  Customer,
  CustomerCreateParams,
  Subscription,
  SubscriptionCreateParams,
  SubscriptionUpdateParams,
  SubscriptionStatus,
  Plan,
  UsageRecord,
  UsageRecordCreateParams,
  StablecoinPayment,
  StablecoinPaymentCreateParams,
  StableCoin,
  CryptoPayment,
  CryptoPaymentCreateParams,
  CryptoCoin,
  Chain,
  WebhookEndpoint,
  WebhookEndpointCreateParams,
  ListResponse,
  Currency,
  FPError,
} from './types.js';

// Re-export errors
export {
  ForgePayError,
  AuthenticationError,
  InvalidRequestError,
  RateLimitError,
  ApiError,
  IdempotencyError,
} from './errors.js';

// Static webhook verification (importable without instantiation)
export { WebhooksResource } from './resources/webhooks.js';

/**
 * ForgePay JavaScript/TypeScript SDK — main entry point.
 *
 * Quick-start:
 * ```ts
 * import { ForgePay } from '@forgepay/sdk';
 *
 * const fp = new ForgePay({ apiKey: process.env.FORGEPAY_API_KEY! });
 *
 * // Create a payment (amount in smallest currency unit — cents for USD)
 * const payment = await fp.payments.create({
 *   amount: 4900,           // $49.00
 *   currency: 'USD',
 *   customerId: 'cus_abc',
 *   idempotencyKey: `order_${orderId}`,  // always use a stable key
 * });
 *
 * // Verify a webhook (in your POST /webhooks handler)
 * const event = ForgePay.webhooks.constructEvent(
 *   rawBody,                           // Buffer or string
 *   request.headers['forgepay-signature'],
 *   process.env.FORGEPAY_WEBHOOK_SECRET!,
 * );
 * ```
 *
 * NOTE: Instantiate ForgePay once at module load time and reuse it.
 *   Each instance creates an httpx connection pool; creating one per request
 *   leaks connections and will hit open-file-descriptor limits under load.
 *
 * NOTE: ForgePay.webhooks is a static property pointing at the WebhooksResource
 *   class itself (not an instance). constructEvent() is a static method so it
 *   can be called without an API key — webhook verification only needs the secret.
 *
 * NOTE: All resource methods accept amounts in the smallest currency unit
 *   (cents for USD/EUR/GBP, etc.). JPY has no sub-unit — pass the full yen amount.
 *   Never use floating-point arithmetic for currency; use integer cents throughout.
 */

import { FPHttpClient, type FPClientOptions } from './client.js';
import { PaymentsResource } from './resources/payments.js';
import { CustomersResource } from './resources/customers.js';
import { SubscriptionsResource, PlansResource, UsageResource } from './resources/subscriptions.js';
import { StablecoinsResource } from './resources/stablecoins.js';
import { CryptoResource } from './resources/crypto.js';
import { WebhooksResource } from './resources/webhooks.js';
import { ProofsResource } from './resources/proofs.js';
import { ShieldedCheckoutResource } from './resources/shielded-checkout.js';
import { AccountsResource } from './resources/accounts.js';

export class ForgePay {
  /** Accept fiat card, bank transfer, and wallet payments */
  readonly payments:         PaymentsResource;
  /** Manage customers */
  readonly customers:        CustomersResource;
  /** Manage subscriptions */
  readonly subscriptions:    SubscriptionsResource;
  /** View and manage billing plans */
  readonly plans:            PlansResource;
  /** Report metered usage (e.g., AI token consumption) */
  readonly usage:            UsageResource;
  /** Accept USDC / USDT stablecoin payments */
  readonly stablecoins:      StablecoinsResource;
  /** Accept Bitcoin, ETH, and 50+ crypto coins */
  readonly crypto:           CryptoResource;
  /** Manage webhook endpoints */
  readonly webhooks:         WebhooksResource;
  /** Client-side ZK proof generation (browser-based) */
  readonly proofs:           ProofsResource;
  /** Privacy-preserving shielded checkout sessions */
  readonly shieldedCheckout: ShieldedCheckoutResource;
  /** Stablecoin-backed accounts: wallets, KYC, deposits, withdrawals */
  readonly accounts:         AccountsResource;

  /** Verify and construct incoming webhook events (static shortcut) */
  static readonly webhooks = WebhooksResource;

  private readonly _httpClient: FPHttpClient;

  constructor(opts: FPClientOptions) {
    this._httpClient       = new FPHttpClient(opts);
    this.payments          = new PaymentsResource(this._httpClient);
    this.customers         = new CustomersResource(this._httpClient);
    this.subscriptions     = new SubscriptionsResource(this._httpClient);
    this.plans             = new PlansResource(this._httpClient);
    this.usage             = new UsageResource(this._httpClient);
    this.stablecoins       = new StablecoinsResource(this._httpClient);
    this.crypto            = new CryptoResource(this._httpClient);
    this.webhooks          = new WebhooksResource(this._httpClient);
    this.proofs            = new ProofsResource(this._httpClient);
    this.shieldedCheckout  = new ShieldedCheckoutResource(this._httpClient);
    this.accounts          = new AccountsResource(this._httpClient);
  }
}

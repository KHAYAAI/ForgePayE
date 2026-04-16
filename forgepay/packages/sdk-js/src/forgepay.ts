/**
 * ForgePay main client class.
 * Instantiate this once and reuse across your application.
 */

import { FPHttpClient, type FPClientOptions } from './client.js';
import { PaymentsResource } from './resources/payments.js';
import { CustomersResource } from './resources/customers.js';
import { SubscriptionsResource, PlansResource, UsageResource } from './resources/subscriptions.js';
import { StablecoinsResource } from './resources/stablecoins.js';
import { CryptoResource } from './resources/crypto.js';
import { WebhooksResource } from './resources/webhooks.js';

export class ForgePay {
  /** Accept fiat card, bank transfer, and wallet payments */
  readonly payments:      PaymentsResource;
  /** Manage customers */
  readonly customers:     CustomersResource;
  /** Manage subscriptions */
  readonly subscriptions: SubscriptionsResource;
  /** View and manage billing plans */
  readonly plans:         PlansResource;
  /** Report metered usage (e.g., AI token consumption) */
  readonly usage:         UsageResource;
  /** Accept USDC / USDT stablecoin payments */
  readonly stablecoins:   StablecoinsResource;
  /** Accept Bitcoin, ETH, and 50+ crypto coins */
  readonly crypto:        CryptoResource;
  /** Manage webhook endpoints */
  readonly webhooks:      WebhooksResource;

  /** Verify and construct incoming webhook events (static shortcut) */
  static readonly webhooks = WebhooksResource;

  private readonly _httpClient: FPHttpClient;

  constructor(opts: FPClientOptions) {
    this._httpClient     = new FPHttpClient(opts);
    this.payments        = new PaymentsResource(this._httpClient);
    this.customers       = new CustomersResource(this._httpClient);
    this.subscriptions   = new SubscriptionsResource(this._httpClient);
    this.plans           = new PlansResource(this._httpClient);
    this.usage           = new UsageResource(this._httpClient);
    this.stablecoins     = new StablecoinsResource(this._httpClient);
    this.crypto          = new CryptoResource(this._httpClient);
    this.webhooks        = new WebhooksResource(this._httpClient);
  }
}

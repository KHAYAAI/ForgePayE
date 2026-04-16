import type { FPHttpClient } from '../client.js';
import type {
  ListResponse,
  Plan,
  Subscription,
  SubscriptionCreateParams,
  SubscriptionUpdateParams,
  UsageRecord,
  UsageRecordCreateParams,
} from '../types.js';

export class SubscriptionsResource {
  constructor(private readonly client: FPHttpClient) {}

  /**
   * Create a subscription.
   *
   * ```ts
   * const sub = await forgepay.subscriptions.create({
   *   customer_id: 'cus_123',
   *   plan_id: 'forgepay-growth-monthly',
   *   trial_days: 14,
   *   idempotency_key: 'sub_create_cus_123',
   * });
   * ```
   */
  async create(params: SubscriptionCreateParams): Promise<Subscription> {
    const { idempotency_key, ...body } = params;
    return this.client.post<Subscription>('/v1/subscriptions', body, {
      idempotencyKey: idempotency_key,
    });
  }

  async retrieve(subscriptionId: string): Promise<Subscription> {
    return this.client.get<Subscription>(`/v1/subscriptions/${subscriptionId}`);
  }

  async update(subscriptionId: string, params: SubscriptionUpdateParams): Promise<Subscription> {
    return this.client.patch<Subscription>(`/v1/subscriptions/${subscriptionId}`, params);
  }

  /**
   * Cancel a subscription.
   *
   * ```ts
   * // Cancel at end of current billing period (recommended)
   * await forgepay.subscriptions.cancel('sub_123', { at_period_end: true });
   *
   * // Cancel immediately
   * await forgepay.subscriptions.cancel('sub_123');
   * ```
   */
  async cancel(
    subscriptionId: string,
    opts?: { at_period_end?: boolean },
  ): Promise<Subscription> {
    return this.client.post<Subscription>(`/v1/subscriptions/${subscriptionId}/cancel`, opts);
  }

  /**
   * Pause a subscription (e.g., customer request, dunning).
   */
  async pause(subscriptionId: string): Promise<Subscription> {
    return this.client.post<Subscription>(`/v1/subscriptions/${subscriptionId}/pause`);
  }

  async resume(subscriptionId: string): Promise<Subscription> {
    return this.client.post<Subscription>(`/v1/subscriptions/${subscriptionId}/resume`);
  }

  async list(params?: {
    customer_id?: string;
    status?:      string;
    limit?:       number;
    cursor?:      string;
  }): Promise<ListResponse<Subscription>> {
    return this.client.get<ListResponse<Subscription>>('/v1/subscriptions', params as Record<string, string | number | undefined>);
  }
}

export class PlansResource {
  constructor(private readonly client: FPHttpClient) {}

  async list(): Promise<ListResponse<Plan>> {
    return this.client.get<ListResponse<Plan>>('/v1/plans');
  }

  async retrieve(planId: string): Promise<Plan> {
    return this.client.get<Plan>(`/v1/plans/${planId}`);
  }
}

export class UsageResource {
  constructor(private readonly client: FPHttpClient) {}

  /**
   * Report usage for a metered subscription.
   *
   * ```ts
   * // Report 150,000 tokens consumed this period
   * await forgepay.usage.report({
   *   subscription_id: 'sub_123',
   *   quantity: 150_000,
   *   timestamp: new Date(),
   *   idempotency_key: `usage_${invoicePeriod}_${jobId}`,
   * });
   * ```
   */
  async report(params: UsageRecordCreateParams): Promise<UsageRecord> {
    const { idempotency_key, subscription_id, ...body } = params;
    return this.client.post<UsageRecord>(
      `/v1/subscriptions/${subscription_id}/usage`,
      {
        ...body,
        timestamp: params.timestamp instanceof Date
          ? Math.floor(params.timestamp.getTime() / 1000)
          : params.timestamp,
      },
      { idempotencyKey: idempotency_key },
    );
  }

  async list(
    subscriptionId: string,
    period?: { start: number; end: number },
  ): Promise<ListResponse<UsageRecord>> {
    return this.client.get<ListResponse<UsageRecord>>(
      `/v1/subscriptions/${subscriptionId}/usage`,
      period,
    );
  }
}

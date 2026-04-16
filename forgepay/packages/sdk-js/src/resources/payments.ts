import type { FPHttpClient } from '../client.js';
import type {
  ListResponse,
  Payment,
  PaymentCreateParams,
  Refund,
  RefundCreateParams,
} from '../types.js';

export class PaymentsResource {
  constructor(private readonly client: FPHttpClient) {}

  /**
   * Create a payment intent.
   *
   * ```ts
   * const payment = await forgepay.payments.create({
   *   amount: 4900,
   *   currency: 'USD',
   *   customer_id: 'cus_123',
   *   idempotency_key: 'order_abc_001',
   * });
   * // → { id: 'pay_...', client_secret: '...', status: 'created' }
   * ```
   */
  async create(params: PaymentCreateParams): Promise<Payment> {
    const { idempotency_key, ...body } = params;
    return this.client.post<Payment>('/v1/payments', body, { idempotencyKey: idempotency_key });
  }

  /**
   * Retrieve a payment by ID.
   */
  async retrieve(paymentId: string): Promise<Payment> {
    return this.client.get<Payment>(`/v1/payments/${paymentId}`);
  }

  /**
   * List payments with optional filters.
   *
   * ```ts
   * const { data } = await forgepay.payments.list({ limit: 20, status: 'succeeded' });
   * ```
   */
  async list(params?: {
    limit?:       number;
    cursor?:      string;
    customer_id?: string;
    status?:      string;
    created_gte?: number;
    created_lte?: number;
  }): Promise<ListResponse<Payment>> {
    return this.client.get<ListResponse<Payment>>('/v1/payments', params as Record<string, string | number | undefined>);
  }

  /**
   * Cancel a payment that has not yet been captured.
   */
  async cancel(paymentId: string, reason?: string): Promise<Payment> {
    return this.client.post<Payment>(`/v1/payments/${paymentId}/cancel`, { reason });
  }

  /**
   * Refund a succeeded payment (full or partial).
   *
   * ```ts
   * // Full refund
   * const refund = await forgepay.payments.refund({ payment_id: 'pay_123' });
   *
   * // Partial refund of $10.00
   * const refund = await forgepay.payments.refund({ payment_id: 'pay_123', amount: 1000 });
   * ```
   */
  async refund(params: RefundCreateParams): Promise<Refund> {
    const { payment_id, ...body } = params;
    return this.client.post<Refund>(`/v1/payments/${payment_id}/refund`, body);
  }
}

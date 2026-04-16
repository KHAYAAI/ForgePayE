import type { FPHttpClient } from '../client.js';
import type { CryptoPayment, CryptoPaymentCreateParams, ListResponse } from '../types.js';

export class CryptoResource {
  constructor(private readonly client: FPHttpClient) {}

  /**
   * Create a crypto payment invoice.
   *
   * The amount is specified in USD and automatically converted to the coin's
   * current exchange rate. The invoice expires after `expires_in` seconds (default 15 min).
   *
   * ```ts
   * const invoice = await forgepay.crypto.create({
   *   coin: 'BTC',
   *   amount_usd: '49.00',
   *   customer_id: 'cus_123',
   * });
   *
   * // Show invoice.address + invoice.amount (in BTC) + invoice.qr_code_url
   * console.log(`Send ${invoice.amount} BTC to ${invoice.address}`);
   * ```
   */
  async create(params: CryptoPaymentCreateParams): Promise<CryptoPayment> {
    const { idempotency_key, ...body } = params;
    return this.client.post<CryptoPayment>('/v1/crypto', body, {
      idempotencyKey: idempotency_key,
    });
  }

  async retrieve(paymentId: string): Promise<CryptoPayment> {
    return this.client.get<CryptoPayment>(`/v1/crypto/${paymentId}`);
  }

  async list(params?: {
    coin?:        string;
    customer_id?: string;
    status?:      string;
    limit?:       number;
    cursor?:      string;
  }): Promise<ListResponse<CryptoPayment>> {
    return this.client.get<ListResponse<CryptoPayment>>('/v1/crypto', params as Record<string, string | number | undefined>);
  }
}

import type { FPHttpClient } from '../client.js';
import type {
  ListResponse,
  StablecoinPayment,
  StablecoinPaymentCreateParams,
} from '../types.js';

export class StablecoinsResource {
  constructor(private readonly client: FPHttpClient) {}

  /**
   * Create a stablecoin payment.
   *
   * Returns a wallet address for the customer to send USDC/USDT to.
   * Listen to the `crypto_payment.confirmed` webhook for settlement.
   *
   * ```ts
   * const payment = await forgepay.stablecoins.create({
   *   amount: '49.00',
   *   currency: 'USDC',
   *   chain: 'base',     // Base L2 — near-zero gas
   *   customer_id: 'cus_123',
   *   idempotency_key: 'order_xyz_usdc',
   * });
   *
   * // Show payment.wallet_address + QR to customer
   * console.log(payment.wallet_address);
   * ```
   */
  async create(params: StablecoinPaymentCreateParams): Promise<StablecoinPayment> {
    const { idempotency_key, ...body } = params;
    return this.client.post<StablecoinPayment>('/v1/stablecoins', body, {
      idempotencyKey: idempotency_key,
    });
  }

  async retrieve(paymentId: string): Promise<StablecoinPayment> {
    return this.client.get<StablecoinPayment>(`/v1/stablecoins/${paymentId}`);
  }

  async list(params?: {
    customer_id?: string;
    currency?:    string;
    chain?:       string;
    status?:      string;
    limit?:       number;
    cursor?:      string;
  }): Promise<ListResponse<StablecoinPayment>> {
    return this.client.get<ListResponse<StablecoinPayment>>('/v1/stablecoins', params as Record<string, string | number | undefined>);
  }
}

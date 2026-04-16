import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FPHttpClient } from '../client.js';
import type { ListResponse, WebhookEndpoint, WebhookEndpointCreateParams } from '../types.js';

export class WebhooksResource {
  constructor(private readonly client: FPHttpClient) {}

  async create(params: WebhookEndpointCreateParams): Promise<WebhookEndpoint & { secret: string }> {
    // Returns the signing secret only on creation — store it immediately!
    return this.client.post<WebhookEndpoint & { secret: string }>('/v1/webhooks', params);
  }

  async retrieve(endpointId: string): Promise<WebhookEndpoint> {
    return this.client.get<WebhookEndpoint>(`/v1/webhooks/${endpointId}`);
  }

  async list(): Promise<ListResponse<WebhookEndpoint>> {
    return this.client.get<ListResponse<WebhookEndpoint>>('/v1/webhooks');
  }

  async update(
    endpointId: string,
    params: Partial<WebhookEndpointCreateParams> & { disabled?: boolean },
  ): Promise<WebhookEndpoint> {
    return this.client.patch<WebhookEndpoint>(`/v1/webhooks/${endpointId}`, params);
  }

  async delete(endpointId: string): Promise<{ id: string; deleted: true }> {
    return this.client.delete(`/v1/webhooks/${endpointId}`);
  }

  /**
   * Verify and construct a ForgePay webhook event from a raw request.
   *
   * Always call this before processing any webhook payload.
   *
   * ```ts
   * // Express / Node.js example
   * app.post('/webhooks/forgepay', express.raw({ type: 'application/json' }), (req, res) => {
   *   const event = ForgePay.webhooks.constructEvent(
   *     req.body,
   *     req.headers['x-forgepay-sig'],
   *     process.env.FORGEPAY_WEBHOOK_SECRET,
   *   );
   *
   *   switch (event.type) {
   *     case 'payment.succeeded':
   *       await fulfillOrder(event.data);
   *       break;
   *   }
   *
   *   res.status(200).send({ received: true });
   * });
   * ```
   */
  static constructEvent(
    payload:   Buffer | string,
    signature: string,
    secret:    string,
  ): { type: string; data: Record<string, unknown>; id: string } {
    if (!secret) throw new Error('ForgePay: webhook secret is required to verify events');

    const body = typeof payload === 'string' ? Buffer.from(payload) : payload;

    // Signature is "sha256=<hex>"
    const sig    = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    const expected = createHmac('sha256', secret).update(body).digest('hex');

    let valid = false;
    try {
      valid = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
    } catch {
      valid = false;
    }

    if (!valid) {
      throw new Error('ForgePay: webhook signature verification failed');
    }

    return JSON.parse(body.toString()) as { type: string; data: Record<string, unknown>; id: string };
  }
}

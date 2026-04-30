import { randomUUID } from 'node:crypto';

export interface WireDetails {
  accountNumber: string;
  routingNumber: string;
  billingName:   string;
}

export interface CirclePaymentIntentRequest {
  idempotencyKey:  string;
  amountUsd:       string;
  chain:           string; // 'MATIC' | 'ETH' | 'BASE' | 'ARB'
}

export interface CirclePaymentIntentResponse {
  id:             string;
  status:         'pending' | 'complete' | 'failed';
  depositAddress: { chain: string; address: string };
  amount?:        { amount: string; currency: string };
}

export interface CircleTransferRequest {
  idempotencyKey: string;
  sourceWalletId: string;
  destinationAddress: string;
  chain:          string;
  amountUsd:      string;
}

export interface CircleTransferResponse {
  id:               string;
  status:           'pending' | 'running' | 'complete' | 'failed';
  transactionHash?: string;
  createDate:       string;
}

export interface CirclePayoutResponse {
  id:     string;
  status: string;
}

const CHAIN_MAP: Record<string, string> = {
  ethereum: 'ETH',
  polygon:  'MATIC',
  base:     'BASE',
  arbitrum: 'ARB',
};

export class CircleClient {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly baseUrl: string,
    private readonly isDev: boolean,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.apiKey) {
      if (this.isDev) {
        return this.mockResponse<T>(method, path, body);
      }
      throw new Error('CIRCLE_API_KEY is required in production');
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(`Circle API error ${res.status}: ${JSON.stringify(err)}`);
    }

    const json = await res.json() as { data: T };
    return json.data;
  }

  async createPaymentIntent(req: CirclePaymentIntentRequest): Promise<CirclePaymentIntentResponse> {
    const chain = CHAIN_MAP[req.chain] ?? req.chain.toUpperCase();
    return this.request<CirclePaymentIntentResponse>('POST', '/paymentIntents', {
      idempotencyKey: req.idempotencyKey,
      amount:         { amount: req.amountUsd, currency: 'USD' },
      settlementCurrency: 'USD',
      paymentMethods: [{ type: 'blockchain', chain }],
    });
  }

  async getPaymentIntent(intentId: string): Promise<CirclePaymentIntentResponse> {
    return this.request<CirclePaymentIntentResponse>('GET', `/paymentIntents/${intentId}`);
  }

  async transferToBlockchain(req: CircleTransferRequest): Promise<CircleTransferResponse> {
    const chain = CHAIN_MAP[req.chain] ?? req.chain.toUpperCase();
    return this.request<CircleTransferResponse>('POST', '/transfers', {
      idempotencyKey: req.idempotencyKey,
      source:         { type: 'wallet', id: req.sourceWalletId },
      destination:    { type: 'blockchain', address: req.destinationAddress, chain },
      amount:         { amount: req.amountUsd, currency: 'USD' },
    });
  }

  async createPayout(
    idempotencyKey: string,
    wire: WireDetails,
    amountUsd: string,
  ): Promise<CirclePayoutResponse> {
    return this.request<CirclePayoutResponse>('POST', '/payouts', {
      idempotencyKey,
      destination: {
        type:          'wire',
        accountNumber: wire.accountNumber,
        routingNumber: wire.routingNumber,
        billingDetails: { name: wire.billingName },
      },
      amount: { amount: amountUsd, currency: 'USD' },
    });
  }

  // Dev-mode mock responses when CIRCLE_API_KEY is not set
  private mockResponse<T>(_method: string, path: string, _body: unknown): T {
    console.warn(`[circle-client] DEV MODE — mocking Circle API call to ${path}`);

    if (path === '/paymentIntents') {
      return {
        id:             `mock-intent-${randomUUID()}`,
        status:         'pending',
        depositAddress: { chain: 'MATIC', address: '0xMockDepositAddress0000000000000000000000' },
      } as unknown as T;
    }
    if (path.startsWith('/paymentIntents/')) {
      return { id: path.split('/').pop(), status: 'complete' } as unknown as T;
    }
    if (path === '/transfers') {
      return {
        id:              `mock-transfer-${randomUUID()}`,
        status:          'complete',
        transactionHash: `0x${'ab'.repeat(32)}`,
        createDate:      new Date().toISOString(),
      } as unknown as T;
    }
    if (path === '/payouts') {
      return { id: `mock-payout-${randomUUID()}`, status: 'pending' } as unknown as T;
    }
    return {} as T;
  }
}

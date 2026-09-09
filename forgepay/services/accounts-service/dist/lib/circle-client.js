import { randomUUID } from 'node:crypto';
const CHAIN_MAP = {
    ethereum: 'ETH',
    polygon: 'MATIC',
    base: 'BASE',
    arbitrum: 'ARB',
};
export class CircleClient {
    apiKey;
    baseUrl;
    isDev;
    constructor(apiKey, baseUrl, isDev) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.isDev = isDev;
    }
    async request(method, path, body) {
        if (!this.apiKey) {
            if (this.isDev) {
                return this.mockResponse(method, path, body);
            }
            throw new Error('CIRCLE_API_KEY is required in production');
        }
        const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ message: res.statusText }));
            throw new Error(`Circle API error ${res.status}: ${JSON.stringify(err)}`);
        }
        const json = await res.json();
        return json.data;
    }
    async createPaymentIntent(req) {
        const chain = CHAIN_MAP[req.chain] ?? req.chain.toUpperCase();
        return this.request('POST', '/paymentIntents', {
            idempotencyKey: req.idempotencyKey,
            amount: { amount: req.amountUsd, currency: 'USD' },
            settlementCurrency: 'USD',
            paymentMethods: [{ type: 'blockchain', chain }],
        });
    }
    async getPaymentIntent(intentId) {
        return this.request('GET', `/paymentIntents/${intentId}`);
    }
    async transferToBlockchain(req) {
        const chain = CHAIN_MAP[req.chain] ?? req.chain.toUpperCase();
        return this.request('POST', '/transfers', {
            idempotencyKey: req.idempotencyKey,
            source: { type: 'wallet', id: req.sourceWalletId },
            destination: { type: 'blockchain', address: req.destinationAddress, chain },
            amount: { amount: req.amountUsd, currency: 'USD' },
        });
    }
    async getPayout(payoutId) {
        return this.request('GET', `/payouts/${payoutId}`);
    }
    async createPayout(idempotencyKey, wire, amountUsd) {
        return this.request('POST', '/payouts', {
            idempotencyKey,
            destination: {
                type: 'wire',
                accountNumber: wire.accountNumber,
                routingNumber: wire.routingNumber,
                billingDetails: { name: wire.billingName },
            },
            amount: { amount: amountUsd, currency: 'USD' },
        });
    }
    // Dev-mode mock responses when CIRCLE_API_KEY is not set
    mockResponse(_method, path, _body) {
        console.warn(`[circle-client] DEV MODE — mocking Circle API call to ${path}`);
        if (path === '/paymentIntents') {
            return {
                id: `mock-intent-${randomUUID()}`,
                status: 'pending',
                depositAddress: { chain: 'MATIC', address: '0xMockDepositAddress0000000000000000000000' },
            };
        }
        if (path.startsWith('/paymentIntents/')) {
            return { id: path.split('/').pop(), status: 'complete' };
        }
        if (path === '/transfers') {
            return {
                id: `mock-transfer-${randomUUID()}`,
                status: 'complete',
                transactionHash: `0x${'ab'.repeat(32)}`,
                createDate: new Date().toISOString(),
            };
        }
        if (path === '/payouts') {
            return { id: `mock-payout-${randomUUID()}`, status: 'pending' };
        }
        return {};
    }
}
//# sourceMappingURL=circle-client.js.map
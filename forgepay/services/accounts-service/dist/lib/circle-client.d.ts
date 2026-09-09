export interface WireDetails {
    accountNumber: string;
    routingNumber: string;
    billingName: string;
}
export interface CirclePaymentIntentRequest {
    idempotencyKey: string;
    amountUsd: string;
    chain: string;
}
export interface CirclePaymentIntentResponse {
    id: string;
    status: 'pending' | 'complete' | 'failed';
    depositAddress: {
        chain: string;
        address: string;
    };
    amount?: {
        amount: string;
        currency: string;
    };
}
export interface CircleTransferRequest {
    idempotencyKey: string;
    sourceWalletId: string;
    destinationAddress: string;
    chain: string;
    amountUsd: string;
}
export interface CircleTransferResponse {
    id: string;
    status: 'pending' | 'running' | 'complete' | 'failed';
    transactionHash?: string;
    createDate: string;
}
export interface CirclePayoutResponse {
    id: string;
    status: string;
    createDate?: string;
    updateDate?: string;
}
export declare class CircleClient {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly isDev;
    constructor(apiKey: string | undefined, baseUrl: string, isDev: boolean);
    private request;
    createPaymentIntent(req: CirclePaymentIntentRequest): Promise<CirclePaymentIntentResponse>;
    getPaymentIntent(intentId: string): Promise<CirclePaymentIntentResponse>;
    transferToBlockchain(req: CircleTransferRequest): Promise<CircleTransferResponse>;
    getPayout(payoutId: string): Promise<CirclePayoutResponse>;
    createPayout(idempotencyKey: string, wire: WireDetails, amountUsd: string): Promise<CirclePayoutResponse>;
    private mockResponse;
}
//# sourceMappingURL=circle-client.d.ts.map
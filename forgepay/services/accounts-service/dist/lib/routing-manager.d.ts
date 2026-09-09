export type PaymentSupplier = 'circle' | 'stablecoin-gateway' | 'direct-blockchain';
export interface RouteDecision {
    supplier: PaymentSupplier;
    chain: string;
    token: 'USDC' | 'USDT';
    estimatedFeeUsd: number;
    estimatedTimeSeconds: number;
    reason: string;
}
export interface RoutingRequest {
    amountUsd: number;
    preferredChain?: string;
    merchantId: string;
    accountId: string;
    urgency?: 'standard' | 'fast';
}
export declare class RoutingManager {
    selectRoute(req: RoutingRequest): RouteDecision;
    private buildDecision;
}
//# sourceMappingURL=routing-manager.d.ts.map
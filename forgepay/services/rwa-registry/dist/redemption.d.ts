import type { RedemptionRequest, RedemptionSpeed } from './types';
/**
 * Create a new redemption request for a position.
 * Validates that the merchant has sufficient units and places a hold.
 */
export declare function createRedemptionRequest(merchantId: string, assetId: string, positionId: string, units: number, speed?: RedemptionSpeed): RedemptionRequest;
/**
 * Process (settle) a redemption request.
 * Stub implementation — in production routes settlement through custodian / on-chain.
 */
export declare function processRedemption(requestId: string): RedemptionRequest;
/**
 * Cancel a pending redemption request and restore the unit hold.
 */
export declare function cancelRedemption(requestId: string): void;
//# sourceMappingURL=redemption.d.ts.map
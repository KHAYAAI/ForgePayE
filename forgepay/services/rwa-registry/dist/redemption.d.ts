import type { RedemptionRequest, RedemptionSpeed } from './types';
/**
 * Create a new redemption request for a position.
 * Validates that the merchant has sufficient units and places a hold.
 *
 * Note: this only places a hold (pendingRedemptionUnits / pendingRedemptionUsd)
 * — it does NOT remove units from position.units. The units remain part of
 * position.units (but unavailable for further redemption, per the
 * availableUnits check below) until processRedemption() actually settles the
 * request and deducts them.
 */
export declare function createRedemptionRequest(merchantId: string, assetId: string, positionId: string, units: number, speed?: RedemptionSpeed): RedemptionRequest;
/**
 * Process (settle) a redemption request.
 *
 * This performs REAL internal-ledger settlement against this registry's own
 * tracked NAV and position data:
 *   - revalues the redemption at the asset's CURRENT NAV (not the estimate
 *     captured at request time, which can be stale by the time this runs)
 *   - releases the pending-redemption hold placed by createRedemptionRequest()
 *   - deducts the redeemed units and their cost basis from the position
 *   - computes the redemption fee and net proceeds
 *   - records a realized capital-gain/loss tax lot when applicable
 *   - transitions the request pending/processing -> settled
 * All of the above is fully and correctly reflected in this service's own
 * books; none of it is a stub.
 *
 * What this does NOT do is move real money or burn real tokens: routing the
 * net proceeds through a custodian or on-chain instrument is the next
 * integration step (see NOTE at the bottom of this function) and is
 * intentionally out of scope for this internal-ledger settlement step.
 */
export declare function processRedemption(requestId: string): RedemptionRequest;
/**
 * Cancel a pending redemption request and restore the unit hold.
 */
export declare function cancelRedemption(requestId: string): void;
//# sourceMappingURL=redemption.d.ts.map
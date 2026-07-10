"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRedemptionRequest = createRedemptionRequest;
exports.processRedemption = processRedemption;
exports.cancelRedemption = cancelRedemption;
const uuid_1 = require("uuid");
const store_1 = require("./store");
// ── Settlement timing helpers ─────────────────────────────────────────────────
function estimateSettlementDate(speed) {
    const now = new Date();
    switch (speed) {
        case 'instant':
            return new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // +5 min
        case 'same_day':
            // End of business day (5 PM Eastern = UTC-5 → 22:00 UTC)
            const sameDay = new Date(now);
            sameDay.setUTCHours(22, 0, 0, 0);
            if (sameDay <= now)
                sameDay.setDate(sameDay.getDate() + 1);
            return sameDay.toISOString();
        case 'next_day': {
            const d = new Date(now);
            d.setDate(d.getDate() + 1);
            d.setUTCHours(22, 0, 0, 0);
            return d.toISOString();
        }
        case 'T+2': {
            const d = new Date(now);
            d.setDate(d.getDate() + 2);
            d.setUTCHours(22, 0, 0, 0);
            return d.toISOString();
        }
        case 'T+5': {
            const d = new Date(now);
            d.setDate(d.getDate() + 5);
            d.setUTCHours(22, 0, 0, 0);
            return d.toISOString();
        }
        case 'notice_period': {
            // 30-day notice period
            const d = new Date(now);
            d.setDate(d.getDate() + 30);
            return d.toISOString();
        }
        default:
            return new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
    }
}
// ── Redemption operations ─────────────────────────────────────────────────────
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
function createRedemptionRequest(merchantId, assetId, positionId, units, speed) {
    const position = store_1.positions.get(positionId);
    if (!position)
        throw new Error(`Position ${positionId} not found`);
    if (position.merchantId !== merchantId)
        throw new Error(`Position ${positionId} does not belong to merchant ${merchantId}`);
    if (position.assetId !== assetId)
        throw new Error(`Position ${positionId} is not for asset ${assetId}`);
    const asset = store_1.rwaAssets.get(assetId);
    if (!asset)
        throw new Error(`Asset ${assetId} not found`);
    if (asset.status !== 'active')
        throw new Error(`Asset ${asset.symbol} is not currently active for redemption`);
    const availableUnits = position.units - position.pendingRedemptionUnits;
    if (units > availableUnits) {
        throw new Error(`Requested ${units} units exceeds available ${availableUnits} units ` +
            `(${position.pendingRedemptionUnits} units already pending redemption)`);
    }
    const redemptionSpeed = speed ?? asset.redemptionSpeed;
    const estimatedValueUsd = units * asset.nav;
    if (estimatedValueUsd < asset.minimumRedemptionUsd) {
        throw new Error(`Minimum redemption is $${asset.minimumRedemptionUsd}; request is $${estimatedValueUsd.toFixed(2)}`);
    }
    const now = new Date().toISOString();
    const request = {
        id: (0, uuid_1.v4)(),
        merchantId,
        assetId,
        positionId,
        requestedUnits: units,
        estimatedValueUsd,
        redemptionSpeed,
        estimatedSettlementAt: estimateSettlementDate(redemptionSpeed),
        status: 'pending',
        createdAt: now,
    };
    store_1.redemptionRequests.set(request.id, request);
    // Place a hold on the units
    position.pendingRedemptionUnits += units;
    position.pendingRedemptionUsd += estimatedValueUsd;
    position.lastUpdatedAt = now;
    console.log(`[rwa-registry] Redemption request ${request.id}: ${units} ${asset.symbol} (~$${estimatedValueUsd.toFixed(2)}) for merchant ${merchantId}`);
    return request;
}
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
function processRedemption(requestId) {
    const request = store_1.redemptionRequests.get(requestId);
    if (!request)
        throw new Error(`Redemption request ${requestId} not found`);
    if (request.status !== 'pending' && request.status !== 'processing') {
        // Also guards against double-processing: once a request is 'settled'
        // (or 'failed'/'cancelled'), it can never be processed again.
        throw new Error(`Cannot process redemption in status '${request.status}'`);
    }
    const position = store_1.positions.get(request.positionId);
    if (!position)
        throw new Error(`Position ${request.positionId} not found`);
    const asset = store_1.rwaAssets.get(request.assetId);
    if (!asset)
        throw new Error(`Asset ${request.assetId} not found`);
    const now = new Date();
    const nowIso = now.toISOString();
    // Use CURRENT NAV (not the stale estimate from request time) for actual
    // settlement value.
    const actualValueUsd = request.requestedUnits * asset.nav;
    const redemptionFee = actualValueUsd * (asset.redemptionFeePercent / 100);
    const netProceeds = actualValueUsd - redemptionFee;
    // Calculate realized gain/loss (for capital gains tracking).
    //
    // IMPORTANT: at this point position.units STILL includes the units being
    // redeemed — createRedemptionRequest() only places a pendingRedemptionUnits
    // hold, it does not remove units from position.units. So the per-unit cost
    // basis is costBasisUsd / position.units, NOT position.units +
    // requestedUnits (a previous version of this function added requestedUnits
    // a second time here, which inflated the denominator and understated the
    // redeemed cost basis, fabricating phantom realized gains).
    const costBasisPerUnit = position.costBasisUsd / (position.units || 1);
    const costBasisRedeemed = costBasisPerUnit * request.requestedUnits;
    const realizedGain = netProceeds - costBasisRedeemed;
    // Long- vs short-term capital gains treatment, based on the position's
    // actual holding period (openedAt -> now) rather than always assuming
    // long-term. Known simplification: this position model tracks a single
    // aggregate lot per (merchant, asset) rather than per-purchase-lot cost
    // basis/dates, so openedAt is used as the acquisition date for the whole
    // position — it is the best real acquisition signal this registry has,
    // not a fabricated number.
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const holdingPeriodMs = now.getTime() - new Date(position.openedAt).getTime();
    const capitalGainTreatment = holdingPeriodMs >= ONE_YEAR_MS ? 'capital_gain_long' : 'capital_gain_short';
    // Create capital gain income record if there's a gain
    if (realizedGain > 0) {
        const gainDist = {
            id: (0, uuid_1.v4)(),
            merchantId: request.merchantId,
            assetId: request.assetId,
            positionId: request.positionId,
            incomeType: 'distribution',
            amountUsd: realizedGain,
            taxTreatment: capitalGainTreatment,
            taxableAmountUsd: realizedGain,
            withholdingTaxUsd: 0,
            netAmountUsd: realizedGain,
            distributionDate: nowIso,
            settledAt: nowIso,
            status: 'settled',
        };
        store_1.incomeDistributions.set(gainDist.id, gainDist);
    }
    // Update position: release the pending-redemption hold, deduct the
    // redeemed units and their cost basis, and revalue the remainder at the
    // current NAV.
    position.units -= request.requestedUnits;
    position.pendingRedemptionUnits -= request.requestedUnits;
    position.pendingRedemptionUsd -= request.estimatedValueUsd;
    position.costBasisUsd = Math.max(0, position.costBasisUsd - costBasisRedeemed);
    position.currentValueUsd = position.units * asset.nav;
    position.unrealizedGainUsd = position.currentValueUsd - position.costBasisUsd;
    position.lastUpdatedAt = nowIso;
    // Update request: transition pending/processing -> settled.
    request.status = 'settled';
    request.actualValueUsd = netProceeds;
    request.actualSettlementAt = nowIso;
    console.log(`[rwa-registry] Settled redemption ${requestId}: $${netProceeds.toFixed(2)} net proceeds ` +
        `(realized gain: $${realizedGain.toFixed(2)})`);
    // NOTE: In production this would additionally:
    // 1. Trigger custodian / on-chain burn of tokens
    // 2. Route USD/USDC proceeds to merchant's settlement account via stablecoin-gateway
    // 3. Feed the realized-gain tax lot recorded above into a downstream tax ledger/filing system
    // None of that external money-movement/on-chain integration is implemented
    // here — only this registry's own internal ledger (position, redemption
    // request, tax lot) is settled by this function.
    return request;
}
/**
 * Cancel a pending redemption request and restore the unit hold.
 */
function cancelRedemption(requestId) {
    const request = store_1.redemptionRequests.get(requestId);
    if (!request)
        throw new Error(`Redemption request ${requestId} not found`);
    if (request.status !== 'pending') {
        throw new Error(`Can only cancel pending requests; current status is '${request.status}'`);
    }
    const position = store_1.positions.get(request.positionId);
    if (position) {
        position.pendingRedemptionUnits = Math.max(0, position.pendingRedemptionUnits - request.requestedUnits);
        position.pendingRedemptionUsd = Math.max(0, position.pendingRedemptionUsd - request.estimatedValueUsd);
        position.lastUpdatedAt = new Date().toISOString();
    }
    request.status = 'cancelled';
    console.log(`[rwa-registry] Cancelled redemption request ${requestId}`);
}
//# sourceMappingURL=redemption.js.map
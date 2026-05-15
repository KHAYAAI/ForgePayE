import { v4 as uuidv4 } from 'uuid';
import type { RedemptionRequest, RedemptionSpeed } from './types';
import { redemptionRequests, positions, rwaAssets, incomeDistributions } from './store';

// ── Settlement timing helpers ─────────────────────────────────────────────────

function estimateSettlementDate(speed: RedemptionSpeed): string {
  const now = new Date();
  switch (speed) {
    case 'instant':
      return new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // +5 min
    case 'same_day':
      // End of business day (5 PM Eastern = UTC-5 → 22:00 UTC)
      const sameDay = new Date(now);
      sameDay.setUTCHours(22, 0, 0, 0);
      if (sameDay <= now) sameDay.setDate(sameDay.getDate() + 1);
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
 */
export function createRedemptionRequest(
  merchantId: string,
  assetId: string,
  positionId: string,
  units: number,
  speed?: RedemptionSpeed,
): RedemptionRequest {
  const position = positions.get(positionId);
  if (!position) throw new Error(`Position ${positionId} not found`);
  if (position.merchantId !== merchantId)
    throw new Error(`Position ${positionId} does not belong to merchant ${merchantId}`);
  if (position.assetId !== assetId)
    throw new Error(`Position ${positionId} is not for asset ${assetId}`);

  const asset = rwaAssets.get(assetId);
  if (!asset) throw new Error(`Asset ${assetId} not found`);
  if (asset.status !== 'active')
    throw new Error(`Asset ${asset.symbol} is not currently active for redemption`);

  const availableUnits = position.units - position.pendingRedemptionUnits;
  if (units > availableUnits) {
    throw new Error(
      `Requested ${units} units exceeds available ${availableUnits} units ` +
      `(${position.pendingRedemptionUnits} units already pending redemption)`,
    );
  }

  const redemptionSpeed = speed ?? asset.redemptionSpeed;
  const estimatedValueUsd = units * asset.nav;

  if (estimatedValueUsd < asset.minimumRedemptionUsd) {
    throw new Error(
      `Minimum redemption is $${asset.minimumRedemptionUsd}; request is $${estimatedValueUsd.toFixed(2)}`,
    );
  }

  const now = new Date().toISOString();
  const request: RedemptionRequest = {
    id: uuidv4(),
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

  redemptionRequests.set(request.id, request);

  // Place a hold on the units
  position.pendingRedemptionUnits += units;
  position.pendingRedemptionUsd += estimatedValueUsd;
  position.lastUpdatedAt = now;

  console.log(
    `[rwa-registry] Redemption request ${request.id}: ${units} ${asset.symbol} (~$${estimatedValueUsd.toFixed(2)}) for merchant ${merchantId}`,
  );

  return request;
}

/**
 * Process (settle) a redemption request.
 * Stub implementation — in production routes settlement through custodian / on-chain.
 */
export function processRedemption(requestId: string): RedemptionRequest {
  const request = redemptionRequests.get(requestId);
  if (!request) throw new Error(`Redemption request ${requestId} not found`);
  if (request.status !== 'pending' && request.status !== 'processing') {
    throw new Error(`Cannot process redemption in status '${request.status}'`);
  }

  const position = positions.get(request.positionId);
  if (!position) throw new Error(`Position ${request.positionId} not found`);

  const asset = rwaAssets.get(request.assetId);
  if (!asset) throw new Error(`Asset ${request.assetId} not found`);

  const now = new Date().toISOString();

  // Use current NAV for actual settlement value
  const actualValueUsd = request.requestedUnits * asset.nav;
  const redemptionFee = actualValueUsd * (asset.redemptionFeePercent / 100);
  const netProceeds = actualValueUsd - redemptionFee;

  // Calculate realized gain/loss (for capital gains tracking)
  const costBasisPerUnit = position.costBasisUsd / (position.units + request.requestedUnits || 1);
  const costBasisRedeemed = costBasisPerUnit * request.requestedUnits;
  const realizedGain = netProceeds - costBasisRedeemed;

  // Create capital gain income record if there's a gain
  if (realizedGain > 0) {
    const gainDist = {
      id: uuidv4(),
      merchantId: request.merchantId,
      assetId: request.assetId,
      positionId: request.positionId,
      incomeType: 'distribution' as const,
      amountUsd: realizedGain,
      taxTreatment: 'capital_gain_long' as const, // Simplified: assume held > 1 year
      taxableAmountUsd: realizedGain,
      withholdingTaxUsd: 0,
      netAmountUsd: realizedGain,
      distributionDate: now,
      settledAt: now,
      status: 'settled' as const,
    };
    incomeDistributions.set(gainDist.id, gainDist);
  }

  // Update position
  position.units -= request.requestedUnits;
  position.pendingRedemptionUnits -= request.requestedUnits;
  position.pendingRedemptionUsd -= request.estimatedValueUsd;
  position.costBasisUsd = Math.max(0, position.costBasisUsd - costBasisRedeemed);
  position.currentValueUsd = position.units * asset.nav;
  position.unrealizedGainUsd = position.currentValueUsd - position.costBasisUsd;
  position.lastUpdatedAt = now;

  // Update request
  request.status = 'settled';
  request.actualValueUsd = netProceeds;
  request.actualSettlementAt = now;

  console.log(
    `[rwa-registry] Settled redemption ${requestId}: $${netProceeds.toFixed(2)} net proceeds ` +
    `(realized gain: $${realizedGain.toFixed(2)})`,
  );

  // NOTE: In production this would:
  // 1. Trigger custodian / on-chain burn of tokens
  // 2. Route USD/USDC proceeds to merchant's settlement account via stablecoin-gateway
  // 3. Update tax ledger

  return request;
}

/**
 * Cancel a pending redemption request and restore the unit hold.
 */
export function cancelRedemption(requestId: string): void {
  const request = redemptionRequests.get(requestId);
  if (!request) throw new Error(`Redemption request ${requestId} not found`);
  if (request.status !== 'pending') {
    throw new Error(`Can only cancel pending requests; current status is '${request.status}'`);
  }

  const position = positions.get(request.positionId);
  if (position) {
    position.pendingRedemptionUnits = Math.max(0, position.pendingRedemptionUnits - request.requestedUnits);
    position.pendingRedemptionUsd = Math.max(0, position.pendingRedemptionUsd - request.estimatedValueUsd);
    position.lastUpdatedAt = new Date().toISOString();
  }

  request.status = 'cancelled';

  console.log(`[rwa-registry] Cancelled redemption request ${requestId}`);
}

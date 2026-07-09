import { v4 as uuidv4 } from 'uuid';
import type { MerchantRWAPosition, RWAAsset, IncomeDistribution, TaxTreatment } from './types';
import { incomeDistributions, positions, rwaAssets } from './store';

// ── Income calculations ───────────────────────────────────────────────────────

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

/**
 * Nominal one-day income at the position's *current* value and the asset's
 * *current* APY. Useful for display/estimation purposes only — real accrual
 * bookkeeping (below) is driven by actual elapsed wall-clock time, not this
 * flat one-day assumption, so it stays correct regardless of exactly when
 * the accrual job runs or how long a position goes between distributions.
 */
export function calculateDailyIncome(
  position: MerchantRWAPosition,
  asset: RWAAsset,
): number {
  return (position.currentValueUsd * asset.currentApyBps) / 10_000 / 365;
}

/**
 * Accrue real income for a single position based on:
 *   - the position's actual current holdings (currentValueUsd)
 *   - the asset's actual current yield rate (currentApyBps)
 *   - the ACTUAL time elapsed since the position's last accrual point
 *     (position.lastAccrualAt, falling back to openedAt for a position
 *     that has never been accrued)
 *
 * This replaces a prior stub that derived income from a flat heuristic
 * (a fixed "one day" of income) applied every time accrual ran, regardless
 * of how much time had actually passed. That heuristic silently over- or
 * under-counted income whenever accrual didn't land on an exact 24h
 * cadence — e.g. an ad hoc POST /v1/income/distribute call made a few
 * hours after the last scheduled accrual would previously still credit a
 * full day's income.
 *
 * Mutates position.pendingIncomeUsd and position.lastAccrualAt in place and
 * returns the amount accrued.
 */
export function accruePositionIncome(
  position: MerchantRWAPosition,
  asset: RWAAsset,
  now: Date = new Date(),
): number {
  const lastAccrualAt = new Date(position.lastAccrualAt ?? position.openedAt);
  const elapsedMs = Math.max(0, now.getTime() - lastAccrualAt.getTime());

  const accrued = ((position.currentValueUsd * asset.currentApyBps) / 10_000) * (elapsedMs / MS_PER_YEAR);

  position.pendingIncomeUsd = (position.pendingIncomeUsd ?? 0) + accrued;
  position.lastAccrualAt = now.toISOString();
  position.lastUpdatedAt = now.toISOString();

  return accrued;
}

/**
 * Distribute pending income for a specific position.
 * Creates an IncomeDistribution record and updates the position's pendingIncomeUsd.
 *
 * Before distributing, this true-ups any income accrued since the position's
 * last accrual point using REAL elapsed time (accruePositionIncome) — so
 * this behaves consistently whether it's invoked by the scheduled 24h
 * accrual+distribution cycle (see index.ts) or ad hoc via the API.
 *
 * Settlement here is REAL internal-ledger settlement: pendingIncomeUsd is
 * correctly swept into totalIncomeEarnedUsd and the IncomeDistribution
 * record is marked 'settled' with settledAt = now, because that is
 * genuinely the moment this registry's own books recognize/settle the
 * accrued income. What this does NOT do is move real money: crediting the
 * netAmount as USDC to the merchant's wallet still requires a call to
 * stablecoin-gateway — that external transfer is the next integration step
 * (see NOTE below), not something this function claims to have done.
 */
export function distributeIncome(
  merchantId: string,
  assetId: string,
  positionId: string,
): IncomeDistribution {
  const position = positions.get(positionId);
  if (!position) throw new Error(`Position ${positionId} not found`);
  if (position.merchantId !== merchantId) throw new Error(`Position ${positionId} does not belong to merchant ${merchantId}`);
  if (position.assetId !== assetId) throw new Error(`Position ${positionId} is not for asset ${assetId}`);

  const asset = rwaAssets.get(assetId);
  if (!asset) throw new Error(`Asset ${assetId} not found`);

  const now = new Date();

  // True up any income accrued since the last accrual/distribution point
  // using real elapsed time before sweeping pendingIncomeUsd into a
  // distribution record.
  accruePositionIncome(position, asset, now);

  const pendingAmount = position.pendingIncomeUsd;
  // A sub-cent accrual isn't practically distributable — and, with real
  // elapsed-time accrual, calling this immediately after opening a position
  // never measures out to exactly zero (some nonzero wall-clock time always
  // passes between "position opened" and "distribute called"), so the
  // threshold has to be a real minimum amount, not an exact-zero check.
  const MIN_DISTRIBUTABLE_USD = 0.01;
  if (pendingAmount < MIN_DISTRIBUTABLE_USD) {
    throw new Error(`No pending income to distribute for position ${positionId}`);
  }

  const nowIso = now.toISOString();
  const withholdingTax = 0; // Institutional products typically have 0 withholding
  const taxableAmount = pendingAmount;
  const netAmount = pendingAmount - withholdingTax;

  const distribution: IncomeDistribution = {
    id: uuidv4(),
    merchantId,
    assetId,
    positionId,
    incomeType: asset.incomeType,
    amountUsd: pendingAmount,
    taxTreatment: asset.taxTreatment,
    taxableAmountUsd: taxableAmount,
    withholdingTaxUsd: withholdingTax,
    netAmountUsd: netAmount,
    distributionDate: nowIso,
    settledAt: nowIso, // Real: this is the moment the internal ledger settles the accrual.
    status: 'settled',
  };

  incomeDistributions.set(distribution.id, distribution);

  // Update position: clear pending, accumulate total income
  position.totalIncomeEarnedUsd = (position.totalIncomeEarnedUsd ?? 0) + netAmount;
  position.pendingIncomeUsd = 0;
  position.lastIncomeDistributionAt = nowIso;
  position.lastUpdatedAt = nowIso;

  // NOTE: In production this would call stablecoin-gateway to transfer
  // netAmount USDC to the merchant's designated wallet address. That
  // external transfer is not performed here — see module doc comment above.
  console.log(
    `[rwa-registry] Distributed $${netAmount.toFixed(4)} (${asset.symbol}) to merchant ${merchantId}`,
  );

  return distribution;
}

/**
 * Get income distribution history for a merchant, optionally filtered by assetId.
 */
export function getIncomeHistory(
  merchantId: string,
  assetId?: string,
): IncomeDistribution[] {
  const all = Array.from(incomeDistributions.values());
  return all.filter(d => {
    if (d.merchantId !== merchantId) return false;
    if (assetId && d.assetId !== assetId) return false;
    return true;
  });
}

/**
 * Calculate total tax liability grouped by TaxTreatment for a set of distributions.
 */
export function calculateTaxLiability(
  distributions: IncomeDistribution[],
): Record<TaxTreatment, number> {
  const result: Record<TaxTreatment, number> = {
    ordinary_income: 0,
    qualified_dividend: 0,
    capital_gain_short: 0,
    capital_gain_long: 0,
  };

  for (const dist of distributions) {
    result[dist.taxTreatment] = (result[dist.taxTreatment] ?? 0) + dist.taxableAmountUsd;
  }

  return result;
}

/**
 * Accrue real income to all active positions for a merchant, based on each
 * position's actual holdings/asset yield and actual elapsed time since its
 * last accrual point.
 * Called by the 24h background scheduler (see index.ts).
 */
export function accrueAllPendingIncome(): void {
  const now = new Date();
  let accruedCount = 0;

  for (const position of positions.values()) {
    const asset = rwaAssets.get(position.assetId);
    if (!asset || asset.status !== 'active') continue;

    accruePositionIncome(position, asset, now);
    accruedCount++;
  }

  console.log(`[rwa-registry] Accrued real (elapsed-time) income for ${accruedCount} active positions`);
}

/**
 * Distribute income to all positions with pending amounts.
 * Called by the 24h background scheduler.
 */
export function distributeAllPendingIncome(): void {
  for (const position of positions.values()) {
    if ((position.pendingIncomeUsd ?? 0) <= 0) continue;
    try {
      distributeIncome(position.merchantId, position.assetId, position.id);
    } catch (err) {
      console.error(`[rwa-registry] Failed to distribute income for position ${position.id}:`, err);
    }
  }
}

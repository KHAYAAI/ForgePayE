import type { MerchantRWAPosition, RWAAsset, IncomeDistribution, TaxTreatment } from './types';
/**
 * Nominal one-day income at the position's *current* value and the asset's
 * *current* APY. Useful for display/estimation purposes only — real accrual
 * bookkeeping (below) is driven by actual elapsed wall-clock time, not this
 * flat one-day assumption, so it stays correct regardless of exactly when
 * the accrual job runs or how long a position goes between distributions.
 */
export declare function calculateDailyIncome(position: MerchantRWAPosition, asset: RWAAsset): number;
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
export declare function accruePositionIncome(position: MerchantRWAPosition, asset: RWAAsset, now?: Date): number;
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
export declare function distributeIncome(merchantId: string, assetId: string, positionId: string): IncomeDistribution;
/**
 * Get income distribution history for a merchant, optionally filtered by assetId.
 */
export declare function getIncomeHistory(merchantId: string, assetId?: string): IncomeDistribution[];
/**
 * Calculate total tax liability grouped by TaxTreatment for a set of distributions.
 */
export declare function calculateTaxLiability(distributions: IncomeDistribution[]): Record<TaxTreatment, number>;
/**
 * Accrue real income to all active positions for a merchant, based on each
 * position's actual holdings/asset yield and actual elapsed time since its
 * last accrual point.
 * Called by the 24h background scheduler (see index.ts).
 */
export declare function accrueAllPendingIncome(): void;
/**
 * Distribute income to all positions with pending amounts.
 * Called by the 24h background scheduler.
 */
export declare function distributeAllPendingIncome(): void;
//# sourceMappingURL=income.d.ts.map
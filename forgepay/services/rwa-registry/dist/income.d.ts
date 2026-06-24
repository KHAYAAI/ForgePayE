import type { MerchantRWAPosition, RWAAsset, IncomeDistribution, TaxTreatment } from './types';
/**
 * Calculate the daily income earned by a position.
 * Formula: (currentValueUsd * apyBps / 10_000) / 365
 */
export declare function calculateDailyIncome(position: MerchantRWAPosition, asset: RWAAsset): number;
/**
 * Distribute pending income for a specific position.
 * Creates an IncomeDistribution record and updates the position's pendingIncomeUsd.
 * In production: transfers net amount to merchant's USDC wallet.
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
 * Accrue daily income to all active positions for a merchant.
 * Called by the 24h background scheduler.
 */
export declare function accrueAllPendingIncome(): void;
/**
 * Distribute income to all positions with pending amounts.
 * Called by the 24h background scheduler.
 */
export declare function distributeAllPendingIncome(): void;
//# sourceMappingURL=income.d.ts.map
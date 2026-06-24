"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDailyIncome = calculateDailyIncome;
exports.distributeIncome = distributeIncome;
exports.getIncomeHistory = getIncomeHistory;
exports.calculateTaxLiability = calculateTaxLiability;
exports.accrueAllPendingIncome = accrueAllPendingIncome;
exports.distributeAllPendingIncome = distributeAllPendingIncome;
const uuid_1 = require("uuid");
const store_1 = require("./store");
// ── Income calculations ───────────────────────────────────────────────────────
/**
 * Calculate the daily income earned by a position.
 * Formula: (currentValueUsd * apyBps / 10_000) / 365
 */
function calculateDailyIncome(position, asset) {
    return (position.currentValueUsd * asset.currentApyBps) / 10_000 / 365;
}
/**
 * Distribute pending income for a specific position.
 * Creates an IncomeDistribution record and updates the position's pendingIncomeUsd.
 * In production: transfers net amount to merchant's USDC wallet.
 */
function distributeIncome(merchantId, assetId, positionId) {
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
    // Accrue daily income to pending if none is pending yet
    let pendingAmount = position.pendingIncomeUsd;
    if (pendingAmount <= 0) {
        pendingAmount = calculateDailyIncome(position, asset);
    }
    const now = new Date().toISOString();
    const withholdingTax = 0; // Institutional products typically have 0 withholding
    const taxableAmount = pendingAmount;
    const netAmount = pendingAmount - withholdingTax;
    const distribution = {
        id: (0, uuid_1.v4)(),
        merchantId,
        assetId,
        positionId,
        incomeType: asset.incomeType,
        amountUsd: pendingAmount,
        taxTreatment: asset.taxTreatment,
        taxableAmountUsd: taxableAmount,
        withholdingTaxUsd: withholdingTax,
        netAmountUsd: netAmount,
        distributionDate: now,
        settledAt: now, // Stub: immediate settlement
        status: 'settled',
    };
    store_1.incomeDistributions.set(distribution.id, distribution);
    // Update position: clear pending, accumulate total income
    position.totalIncomeEarnedUsd = (position.totalIncomeEarnedUsd ?? 0) + netAmount;
    position.pendingIncomeUsd = 0;
    position.lastIncomeDistributionAt = now;
    position.lastUpdatedAt = now;
    // NOTE: In production this would call stablecoin-gateway to transfer
    // netAmount USDC to the merchant's designated wallet address.
    console.log(`[rwa-registry] Distributed $${netAmount.toFixed(4)} (${asset.symbol}) to merchant ${merchantId}`);
    return distribution;
}
/**
 * Get income distribution history for a merchant, optionally filtered by assetId.
 */
function getIncomeHistory(merchantId, assetId) {
    const all = Array.from(store_1.incomeDistributions.values());
    return all.filter(d => {
        if (d.merchantId !== merchantId)
            return false;
        if (assetId && d.assetId !== assetId)
            return false;
        return true;
    });
}
/**
 * Calculate total tax liability grouped by TaxTreatment for a set of distributions.
 */
function calculateTaxLiability(distributions) {
    const result = {
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
 * Accrue daily income to all active positions for a merchant.
 * Called by the 24h background scheduler.
 */
function accrueAllPendingIncome() {
    for (const position of store_1.positions.values()) {
        const asset = store_1.rwaAssets.get(position.assetId);
        if (!asset || asset.status !== 'active')
            continue;
        const daily = calculateDailyIncome(position, asset);
        position.pendingIncomeUsd = (position.pendingIncomeUsd ?? 0) + daily;
        position.lastUpdatedAt = new Date().toISOString();
    }
    console.log(`[rwa-registry] Accrued daily income for ${store_1.positions.size} positions`);
}
/**
 * Distribute income to all positions with pending amounts.
 * Called by the 24h background scheduler.
 */
function distributeAllPendingIncome() {
    for (const position of store_1.positions.values()) {
        if ((position.pendingIncomeUsd ?? 0) <= 0)
            continue;
        try {
            distributeIncome(position.merchantId, position.assetId, position.id);
        }
        catch (err) {
            console.error(`[rwa-registry] Failed to distribute income for position ${position.id}:`, err);
        }
    }
}
//# sourceMappingURL=income.js.map
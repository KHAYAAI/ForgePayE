export type RWAAssetClass = 'treasury_bill' | 'money_market' | 'corporate_bond' | 'equity' | 'real_estate' | 'commodity' | 'private_credit' | 'infrastructure';
export type IncomeType = 'interest' | 'dividend' | 'coupon' | 'rental' | 'distribution';
export type TaxTreatment = 'ordinary_income' | 'qualified_dividend' | 'capital_gain_short' | 'capital_gain_long';
export type RedemptionSpeed = 'instant' | 'same_day' | 'next_day' | 'T+2' | 'T+5' | 'notice_period';
export type RWAStatus = 'active' | 'suspended' | 'liquidating' | 'matured';
export interface RWAAsset {
    id: string;
    name: string;
    symbol: string;
    issuer: string;
    assetClass: RWAAssetClass;
    description: string;
    currentApyBps: number;
    historicalApy30dBps: number;
    historicalApy90dBps: number;
    yieldFrequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
    incomeType: IncomeType;
    taxTreatment: TaxTreatment;
    redemptionSpeed: RedemptionSpeed;
    minimumInvestmentUsd: number;
    minimumRedemptionUsd: number;
    redemptionFeePercent: number;
    contractAddress?: string;
    chain?: string;
    requiresKyc: boolean;
    requiresAccreditedInvestor: boolean;
    supportedJurisdictions: string[];
    status: RWAStatus;
    totalAumUsd: number;
    nav: number;
    navUpdatedAt: string;
    createdAt: string;
    updatedAt: string;
}
export interface MerchantRWAPosition {
    id: string;
    merchantId: string;
    assetId: string;
    units: number;
    costBasisUsd: number;
    currentValueUsd: number;
    unrealizedGainUsd: number;
    totalIncomeEarnedUsd: number;
    pendingIncomeUsd: number;
    lastIncomeDistributionAt?: string;
    pendingRedemptionUnits: number;
    pendingRedemptionUsd: number;
    openedAt: string;
    lastUpdatedAt: string;
}
export interface IncomeDistribution {
    id: string;
    merchantId: string;
    assetId: string;
    positionId: string;
    incomeType: IncomeType;
    amountUsd: number;
    taxTreatment: TaxTreatment;
    taxableAmountUsd: number;
    withholdingTaxUsd: number;
    netAmountUsd: number;
    distributionDate: string;
    settledAt?: string;
    status: 'pending' | 'settled' | 'failed';
}
export interface RedemptionRequest {
    id: string;
    merchantId: string;
    assetId: string;
    positionId: string;
    requestedUnits: number;
    estimatedValueUsd: number;
    actualValueUsd?: number;
    redemptionSpeed: RedemptionSpeed;
    estimatedSettlementAt: string;
    actualSettlementAt?: string;
    status: 'pending' | 'processing' | 'settled' | 'failed' | 'cancelled';
    failureReason?: string;
    createdAt: string;
}
//# sourceMappingURL=types.d.ts.map
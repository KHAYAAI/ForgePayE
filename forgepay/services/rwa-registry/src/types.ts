export type RWAAssetClass =
  | 'treasury_bill'       // US T-bills (Ondo USDY, Franklin Templeton FOBXX, OpenEden)
  | 'money_market'        // Money market funds
  | 'corporate_bond'      // Investment grade bonds
  | 'equity'              // Tokenized equities
  | 'real_estate'         // REITs or direct property
  | 'commodity'           // Gold, commodities
  | 'private_credit'      // Private debt/credit
  | 'infrastructure';     // Infrastructure assets

export type IncomeType = 'interest' | 'dividend' | 'coupon' | 'rental' | 'distribution';
export type TaxTreatment = 'ordinary_income' | 'qualified_dividend' | 'capital_gain_short' | 'capital_gain_long';
export type RedemptionSpeed = 'instant' | 'same_day' | 'next_day' | 'T+2' | 'T+5' | 'notice_period';
export type RWAStatus = 'active' | 'suspended' | 'liquidating' | 'matured';

export interface RWAAsset {
  id: string;
  name: string;
  symbol: string;             // e.g. 'USDY', 'FOBXX', 'OUSG', 'BUIDL'
  issuer: string;             // e.g. 'Ondo Finance', 'Franklin Templeton', 'BlackRock'
  assetClass: RWAAssetClass;
  description: string;

  // Yield characteristics
  currentApyBps: number;      // basis points, e.g. 525 = 5.25%
  historicalApy30dBps: number;
  historicalApy90dBps: number;
  yieldFrequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  incomeType: IncomeType;
  taxTreatment: TaxTreatment;

  // Liquidity / Redemption
  redemptionSpeed: RedemptionSpeed;
  minimumInvestmentUsd: number;
  minimumRedemptionUsd: number;
  redemptionFeePercent: number;  // 0 for most T-bill funds

  // On-chain details
  contractAddress?: string;   // ERC-20 address if tokenized
  chain?: string;             // 'ethereum', 'polygon', 'stellar', 'avalanche'

  // KYC / Accreditation
  requiresKyc: boolean;
  requiresAccreditedInvestor: boolean;
  supportedJurisdictions: string[];  // ISO country codes or ['all']

  // Status
  status: RWAStatus;
  totalAumUsd: number;        // total assets under management
  nav: number;                // net asset value per token (USD)
  navUpdatedAt: string;

  createdAt: string;
  updatedAt: string;
}

export interface MerchantRWAPosition {
  id: string;
  merchantId: string;
  assetId: string;

  // Position details
  units: number;              // number of tokens held
  costBasisUsd: number;       // total cost basis
  currentValueUsd: number;    // units * current NAV
  unrealizedGainUsd: number;  // currentValue - costBasis

  // Income tracking
  totalIncomeEarnedUsd: number;
  pendingIncomeUsd: number;   // income not yet distributed
  lastIncomeDistributionAt?: string;
  lastAccrualAt?: string;     // last time real elapsed-time income accrual ran (defaults to openedAt)

  // Redemption
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
  withholdingTaxUsd: number;   // 0 for most institutional products
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
  actualValueUsd?: number;    // set on settlement

  redemptionSpeed: RedemptionSpeed;
  estimatedSettlementAt: string;
  actualSettlementAt?: string;

  status: 'pending' | 'processing' | 'settled' | 'failed' | 'cancelled';
  failureReason?: string;

  createdAt: string;
}

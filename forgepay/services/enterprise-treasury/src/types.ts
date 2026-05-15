export interface AccountBalance {
  accountId: string;
  bankName: string;
  accountName: string;
  accountType: 'checking' | 'savings' | 'money_market' | 'crypto';
  currency: string;
  balanceNative: number;        // In native currency
  balanceUsd: number;           // Converted to USD
  subsidiary: string;           // Which business unit
  plaidItemId?: string;
  lastUpdated: string;          // ISO timestamp
}

export interface CashPosition {
  totalUsd: number;
  bySubsidiary: Record<string, SubsidiaryPosition>;
  byCurrency: Record<string, CurrencyPosition>;
  idleCashUsd: number;          // Earning 0% yield
  deployedInYieldUsd: number;   // Earning yield
  opportunityCostUsdPerYear: number; // If idle deployed at 4%
  lastConsolidated: string;
}

export interface SubsidiaryPosition {
  name: string;
  totalUsd: number;
  accountCount: number;
  currencies: string[];
  runwayDays: number;           // Days until cash runs out at current burn
  accounts: AccountBalance[];
}

export interface CurrencyPosition {
  currency: string;
  balanceNative: number;
  balanceUsd: number;
  fxRate: number;
  accountCount: number;
}

export type RuleConditionType =
  | 'balance_above'
  | 'balance_below'
  | 'upcoming_payment'
  | 'yield_earned_above'
  | 'runway_below_days'
  | 'scheduled';

export type RuleActionType =
  | 'sweep_to_yield'
  | 'repatriate_from_yield'
  | 'allocate_tax_escrow'
  | 'send_intercompany'
  | 'notify_cfo'
  | 'require_approval';

export interface TreasuryRule {
  id: string;
  name: string;
  enabled: boolean;
  condition: {
    type: RuleConditionType;
    subsidiary?: string;
    currency?: string;
    threshold?: number;        // USD amount
    daysAhead?: number;        // For upcoming_payment
    cronSchedule?: string;     // For scheduled
  };
  action: {
    type: RuleActionType;
    targetVault?: 'aave' | 'compound' | 'ondo';
    minApy?: number;
    keepLiquidUsd?: number;    // Reserve this much cash
    taxEscrowPercent?: number; // % of yield to tax escrow
    notifyEmails?: string[];
  };
  approvalRequired: boolean;
  lastTriggered?: string;
  executionCount: number;
}

export interface NettingFlow {
  fromSubsidiary: string;
  toSubsidiary: string;
  amount: number;              // USD
  currency: string;
  invoiceRef?: string;
  dueDate: string;
}

export interface NettingResult {
  fromSubsidiary: string;
  toSubsidiary: string;
  grossAmount: number;
  netAmount: number;
  feesSavedUsd: number;
  pendingFlows: NettingFlow[];
}

/**
 * ForgePay Institutional Reporting — Type Definitions
 *
 * Shared report shapes consumed by CFOs, finance teams, and external auditors.
 * All monetary values are USD unless explicitly noted.
 */

export type ReportType =
  | 'cash_flow'
  | 'yield_income'
  | 'netting'
  | 'audit_trail'
  | 'tax_filing';

export type Jurisdiction = 'US' | 'UK' | 'EU' | 'SG' | 'AU';

export interface ReportPeriod {
  start: string;     // ISO date
  end: string;       // ISO date
}

export interface ReportMetadata {
  id: string;
  type: ReportType;
  period: ReportPeriod;
  generatedAt: string;
  generatedByCorrelationId?: string;
  sizeBytes: number;
}

export interface CashFlowLineItem {
  date: string;
  category: 'operating_inflow' | 'operating_outflow' | 'investing' | 'financing';
  description: string;
  amountUsd: number;
}

export interface CashFlowReport {
  period: ReportPeriod;
  enterpriseId: string;
  operatingInflowsUsd: number;
  operatingOutflowsUsd: number;
  investingFlowsUsd: number;       // Yield sweeps & redemptions
  financingFlowsUsd: number;       // Credit line draws/repayments
  netChangeUsd: number;
  beginningBalanceUsd: number;
  endingBalanceUsd: number;
  lineItems: CashFlowLineItem[];
  data_source_errors?: string[];
}

export interface YieldVaultBreakdown {
  principalUsd: number;
  yieldUsd: number;
  apyAvg: number;
}

export interface YieldIncomeReport {
  period: ReportPeriod;
  totalYieldUsd: number;
  byVault: Record<string, YieldVaultBreakdown>;
  taxableIncomeUsd: number;
  federalTaxEstimateUsd: number;
  data_source_errors?: string[];
}

export interface NettingPairLine {
  fromSubsidiary: string;
  toSubsidiary: string;
  grossUsd: number;
  netUsd: number;
  feesAvoidedUsd: number;
}

export interface NettingReport {
  period: ReportPeriod;
  totalGrossFlowsUsd: number;
  totalNetFlowsUsd: number;
  feesAvoidedUsd: number;
  byPair: NettingPairLine[];
  reductionPercent: number;
  data_source_errors?: string[];
}

export interface AuditEvent {
  id?: string;
  timestamp: string;
  actor: string;       // admin id
  action: string;
  resource?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditTrailReport {
  period: ReportPeriod;
  totalEvents: number;
  byActor: Record<string, number>;
  byAction: Record<string, number>;
  criticalEvents: AuditEvent[];
  data_source_errors?: string[];
}

export interface TaxFilingLine {
  lineCode: string;
  description: string;
  amountUsd: number;
}

export interface TaxFilingPacket {
  jurisdiction: Jurisdiction;
  period: ReportPeriod;
  lines: TaxFilingLine[];
  generatedAt: string;
}

export type ReportPayload =
  | CashFlowReport
  | YieldIncomeReport
  | NettingReport
  | AuditTrailReport
  | TaxFilingPacket;

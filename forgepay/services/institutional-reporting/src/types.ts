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
  /**
   * null: no revenue or expense source is connected. These were invented
   * ($50K / $35K a day) and drove the beginning balance.
   */
  operatingInflowsUsd: number | null;
  operatingOutflowsUsd: number | null;
  investingFlowsUsd: number;       // Yield sweeps & redemptions
  financingFlowsUsd: number;       // Credit line draws/repayments
  /** null while operating flows are unknown. */
  netChangeUsd: number | null;
  /** null while the net change is unknown. */
  beginningBalanceUsd: number | null;
  /** null if treasury's cash position could not be read. */
  endingBalanceUsd: number | null;
  lineItems: CashFlowLineItem[];
  /** false when any figure is missing; never present partial data as whole. */
  complete: boolean;
  notes: string[];
  data_source_errors?: string[];
}

export interface YieldVaultBreakdown {
  principalUsd: number;
  yieldUsd: number;
  apyAvg: number;
}

export interface YieldIncomeReport {
  period: ReportPeriod;
  /** null when positions could not be read — not zero. */
  totalYieldUsd: number | null;
  byVault: Record<string, YieldVaultBreakdown>;
  taxableIncomeUsd: number | null;
  /** Illustrative US federal corporate rate (21%) only; not tax advice. */
  federalTaxEstimateUsd: number | null;
  complete: boolean;
  notes: string[];
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
  /** Empty while no source of taxable amounts is connected. */
  lines: TaxFilingLine[];
  available: boolean;
  reason?: string;
  generatedAt: string;
}

export type ReportPayload =
  | CashFlowReport
  | YieldIncomeReport
  | NettingReport
  | AuditTrailReport
  | TaxFilingPacket;

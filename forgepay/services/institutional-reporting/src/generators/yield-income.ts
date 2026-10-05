/**
 * Yield Income Report Generator
 *
 * Aggregates yield earnings across all deployed vaults (Aave, Compound, Ondo,
 * etc.) and produces a taxable-income breakdown with a federal tax estimate.
 * Real-world tax rates require mor-layer jurisdiction lookup; here we use a
 * flat 21% (US federal corporate rate) as a conservative reserve.
 */

import type {
  YieldIncomeReport,
  YieldVaultBreakdown,
  ReportPeriod,
} from '../types';

export interface YieldIncomeInput {
  periodStart: string;
  periodEnd: string;
  yieldEngineBaseUrl: string;
}

interface YieldPosition {
  vaultName?: string;
  vault?: string;
  principalUsd?: number;
  yieldEarnedUsd?: number;
  yieldUsd?: number;
  apy?: number;
}

interface PositionsResponse {
  data?: YieldPosition[];
  positions?: YieldPosition[];
}

const FEDERAL_CORPORATE_RATE = 0.21;
const FETCH_TIMEOUT_MS       = 15_000;

export async function generateYieldIncomeReport(
  input: YieldIncomeInput,
): Promise<YieldIncomeReport> {
  const period: ReportPeriod = { start: input.periodStart, end: input.periodEnd };
  const errors: string[] = [];
  const byVault: Record<string, YieldVaultBreakdown> = {};

  // yield-engine has no cross-merchant positions endpoint: its routes are
  // under /api/v1 and scoped to one merchant's JWT. This called
  // /v1/positions/all, which does not exist, and on the error reported zero
  // yield and zero tax as if they were real. Not connected; say so.
  void input;
  errors.push('yield-engine: not connected (no positions endpoint this service can read)');

  const report: YieldIncomeReport = {
    period,
    totalYieldUsd:         null,
    byVault,
    taxableIncomeUsd:      null,
    federalTaxEstimateUsd: null,
    complete:              false,
    notes: ['Yield income is not available: this service cannot read yield positions.'],
  };
  if (errors.length > 0) report.data_source_errors = errors;
  return report;
}

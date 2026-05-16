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
  let positions: YieldPosition[] = [];

  try {
    const res = await fetch(`${input.yieldEngineBaseUrl}/v1/positions/all`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      errors.push(`positions: HTTP ${res.status}`);
    } else {
      const body = (await res.json()) as PositionsResponse;
      positions = body.data ?? body.positions ?? [];
    }
  } catch (err) {
    errors.push(`positions: ${(err as Error).message}`);
  }

  for (const pos of positions) {
    const vault = pos.vaultName ?? pos.vault ?? 'unknown';
    const principal = pos.principalUsd ?? 0;
    const yieldUsd  = pos.yieldEarnedUsd ?? pos.yieldUsd ?? 0;
    const apy       = pos.apy ?? 0;
    if (!byVault[vault]) {
      byVault[vault] = { principalUsd: 0, yieldUsd: 0, apyAvg: 0 };
    }
    const prev = byVault[vault];
    // Weighted APY by principal
    const totalPrincipal = prev.principalUsd + principal;
    prev.apyAvg = totalPrincipal > 0
      ? (prev.apyAvg * prev.principalUsd + apy * principal) / totalPrincipal
      : apy;
    prev.principalUsd = totalPrincipal;
    prev.yieldUsd    += yieldUsd;
  }

  const totalYieldUsd = Object.values(byVault).reduce((s, v) => s + v.yieldUsd, 0);
  const taxableIncomeUsd      = totalYieldUsd;
  const federalTaxEstimateUsd = Math.round(taxableIncomeUsd * FEDERAL_CORPORATE_RATE * 100) / 100;

  const report: YieldIncomeReport = {
    period,
    totalYieldUsd,
    byVault,
    taxableIncomeUsd,
    federalTaxEstimateUsd,
  };
  if (errors.length > 0) report.data_source_errors = errors;
  return report;
}

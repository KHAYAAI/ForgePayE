/**
 * Netting Report Generator
 *
 * Pulls bilateral subsidiary flow results from enterprise-treasury's netting
 * engine and projects them into a finance-team-friendly report showing how
 * much wire and FX fee burden was avoided.
 */

import type {
  NettingReport,
  NettingPairLine,
  ReportPeriod,
} from '../types';

export interface NettingInput {
  periodStart: string;
  periodEnd: string;
  treasuryBaseUrl: string;
}

interface NettingResult {
  fromSubsidiary?: string;
  toSubsidiary?: string;
  grossAmount?: number;
  netAmount?: number;
  feesSavedUsd?: number;
}

interface NettingResponse {
  data?: NettingResult[];
  summary?: {
    totalGrossUsd?: number;
    totalNetUsd?: number;
    totalFeesSavedUsd?: number;
    reductionPercent?: number;
  };
}

const FETCH_TIMEOUT_MS = 15_000;

export async function generateNettingReport(
  input: NettingInput,
): Promise<NettingReport> {
  const period: ReportPeriod = { start: input.periodStart, end: input.periodEnd };
  const errors: string[] = [];
  const byPair: NettingPairLine[] = [];

  let totalGrossFlowsUsd = 0;
  let totalNetFlowsUsd   = 0;
  let feesAvoidedUsd     = 0;
  let reductionPercent   = 0;

  try {
    const res = await fetch(`${input.treasuryBaseUrl}/v1/netting/calculate`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      errors.push(`netting: HTTP ${res.status}`);
    } else {
      const body = (await res.json()) as NettingResponse;
      for (const r of body.data ?? []) {
        byPair.push({
          fromSubsidiary: r.fromSubsidiary ?? 'unknown',
          toSubsidiary:   r.toSubsidiary ?? 'unknown',
          grossUsd:       r.grossAmount ?? 0,
          netUsd:         r.netAmount ?? 0,
          feesAvoidedUsd: r.feesSavedUsd ?? 0,
        });
      }
      totalGrossFlowsUsd = body.summary?.totalGrossUsd ?? byPair.reduce((s, p) => s + p.grossUsd, 0);
      totalNetFlowsUsd   = body.summary?.totalNetUsd ?? byPair.reduce((s, p) => s + p.netUsd, 0);
      feesAvoidedUsd     = body.summary?.totalFeesSavedUsd ?? byPair.reduce((s, p) => s + p.feesAvoidedUsd, 0);
      reductionPercent   = body.summary?.reductionPercent ?? (
        totalGrossFlowsUsd > 0
          ? Math.round(((totalGrossFlowsUsd - totalNetFlowsUsd) / totalGrossFlowsUsd) * 100)
          : 0
      );
    }
  } catch (err) {
    errors.push(`netting: ${(err as Error).message}`);
  }

  const report: NettingReport = {
    period,
    totalGrossFlowsUsd,
    totalNetFlowsUsd,
    feesAvoidedUsd,
    byPair,
    reductionPercent,
  };
  if (errors.length > 0) report.data_source_errors = errors;
  return report;
}

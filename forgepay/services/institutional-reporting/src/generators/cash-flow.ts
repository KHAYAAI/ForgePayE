/**
 * Cash Flow Report Generator
 *
 * Fetches consolidated cash position from enterprise-treasury and execution
 * log entries to produce a GAAP-style statement of cash flows decomposed into
 * operating, investing (yield sweeps), and financing (credit) activities.
 *
 * Resilience: any upstream failure is captured in `data_source_errors` so the
 * report is still returned (auditors prefer partial data over no data).
 */

import type {
  CashFlowReport,
  CashFlowLineItem,
  ReportPeriod,
} from '../types';

export interface CashFlowInput {
  enterpriseId: string;
  periodStart: string;
  periodEnd: string;
  treasuryBaseUrl: string;
  /** enterprise-treasury requires x-api-key on every route. */
  treasuryApiKey?: string;
}

interface CashPositionResponse {
  data?: {
    totalUsd?: number;
    idleCashUsd?: number;
    deployedInYieldUsd?: number;
  };
}

interface ExecutionLogEntry {
  ruleId?: string;
  ruleName?: string;
  result?: string;
  actionType?: string;
  amountUsd?: number;
  timestamp?: string;
}

interface ExecutionLogResponse {
  data?: ExecutionLogEntry[];
}

const FETCH_TIMEOUT_MS = 15_000;

export async function generateCashFlowReport(
  input: CashFlowInput,
): Promise<CashFlowReport> {
  const period: ReportPeriod = { start: input.periodStart, end: input.periodEnd };
  const errors: string[] = [];

  let endingBalanceUsd: number | null = null;
  let deployedInYieldUsd = 0;
  const headers: Record<string, string> = input.treasuryApiKey ? { 'x-api-key': input.treasuryApiKey } : {};

  try {
    const res = await fetch(`${input.treasuryBaseUrl}/v1/cash-position`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      errors.push(`cash-position: HTTP ${res.status}`);
    } else {
      const body = (await res.json()) as CashPositionResponse;
      endingBalanceUsd  = typeof body.data?.totalUsd === 'number' ? body.data.totalUsd : null;
      deployedInYieldUsd = body.data?.deployedInYieldUsd ?? 0;
    }
  } catch (err) {
    errors.push(`cash-position: ${(err as Error).message}`);
  }

  let execEntries: ExecutionLogEntry[] = [];
  try {
    const res = await fetch(
      `${input.treasuryBaseUrl}/v1/rules/execution-log?limit=200`,
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) {
      errors.push(`execution-log: HTTP ${res.status}`);
    } else {
      const body = (await res.json()) as ExecutionLogResponse;
      execEntries = body.data ?? [];
    }
  } catch (err) {
    errors.push(`execution-log: ${(err as Error).message}`);
  }

  // Decompose execution-log entries into cash-flow line items.
  const lineItems: CashFlowLineItem[] = [];
  let investingFlowsUsd = 0;
  let financingFlowsUsd = 0;

  const startMs = new Date(input.periodStart).getTime();
  const endMs   = new Date(input.periodEnd).getTime() + 86_400_000; // end date inclusive
  for (const entry of execEntries) {
    if (entry.result !== 'executed') continue;
    // Only this period's activity; the log is not filtered upstream.
    const at = entry.timestamp ? new Date(entry.timestamp).getTime() : NaN;
    if (!(at >= startMs && at < endMs)) continue;
    const amount = entry.amountUsd ?? 0;
    const ts    = entry.timestamp ?? input.periodEnd;
    switch (entry.actionType) {
      case 'sweep_to_yield':
        investingFlowsUsd -= amount;
        lineItems.push({
          date:        ts,
          category:    'investing',
          description: `Sweep to ${entry.ruleName ?? 'yield vault'}`,
          amountUsd:   -amount,
        });
        break;
      case 'repatriate_from_yield':
        investingFlowsUsd += amount;
        lineItems.push({
          date:        ts,
          category:    'investing',
          description: `Repatriate from ${entry.ruleName ?? 'yield vault'}`,
          amountUsd:   amount,
        });
        break;
      case 'allocate_tax_escrow':
      case 'send_intercompany':
        financingFlowsUsd -= amount;
        lineItems.push({
          date:        ts,
          category:    'financing',
          description: entry.ruleName ?? entry.actionType,
          amountUsd:   -amount,
        });
        break;
      default:
        // notify_cfo / require_approval are non-cash events
        break;
    }
  }

  // No revenue or expense source is connected. These used to be invented
  // ($50K in / $35K out per day) and the beginning balance was derived from
  // them, so every figure below the line was fiction. They are unknown.
  const operatingInflowsUsd: number | null  = null;
  const operatingOutflowsUsd: number | null = null;
  const netChangeUsd: number | null = null;
  const beginningBalanceUsd: number | null = null;
  const notes = [
    'Operating inflows and outflows are not available: no revenue or expense source is connected.',
    'Net change and beginning balance cannot be derived without operating flows.',
  ];

  const report: CashFlowReport = {
    period,
    enterpriseId: input.enterpriseId,
    operatingInflowsUsd,
    operatingOutflowsUsd,
    investingFlowsUsd,
    financingFlowsUsd,
    netChangeUsd,
    beginningBalanceUsd,
    endingBalanceUsd,
    lineItems,
    complete: false,
    notes,
  };
  if (errors.length > 0) report.data_source_errors = errors;
  // deployedInYieldUsd is captured for parity with treasury snapshot but not in
  // the strict cash-flow schema; auditors expect to reconcile separately.
  void deployedInYieldUsd;
  return report;
}

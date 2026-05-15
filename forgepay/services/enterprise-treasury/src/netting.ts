/**
 * Intercompany Netting Engine
 *
 * Graph-based algorithm that consolidates bilateral payment flows between
 * subsidiaries and calculates the minimum net settlement amounts, reducing
 * wire transfer fees and FX conversion costs.
 *
 * Algorithm:
 *   1. Build directed adjacency map from all pending flows (from → to → amount)
 *   2. For each unique pair (A, B), compute gross vs net obligations
 *   3. Net party owes |A→B - B→A|; if zero, no settlement needed
 *   4. Calculate fee savings based on transactions avoided
 *
 * In production:
 *   - Flows persisted in PostgreSQL with ERP system integration
 *   - Multi-currency netting with FX hedging recommendations
 *   - Settlement instructions routed via bank-connectivity service
 */

import { NettingFlow, NettingResult } from './types';

// In-memory flow store. In production: PostgreSQL with settlement state machine.
const flows: NettingFlow[] = [];

// ── Flow management ───────────────────────────────────────────────────────────

export function addFlow(flow: NettingFlow): void {
  flows.push(flow);
}

export function listFlows(): NettingFlow[] {
  return [...flows];
}

export function clearSettledFlows(): void {
  flows.length = 0;
}

// ── Netting calculation ───────────────────────────────────────────────────────

/**
 * Calculates the minimum net settlement obligations for all intercompany flows.
 *
 * For each unique subsidiary pair, sums all flows in both directions and returns:
 *   - grossAmount: total value of all transactions between the pair (both directions)
 *   - netAmount:   the single net payment the net-debtor owes the net-creditor
 *   - feesSavedUsd: estimated wire fee savings ($25 per avoided transaction)
 */
export function calculateNetting(): NettingResult[] {
  if (flows.length === 0) return [];

  // Build directed adjacency map: from → to → cumulative USD amount
  const flowMap: Record<string, Record<string, number>> = {};

  for (const flow of flows) {
    if (!flowMap[flow.fromSubsidiary]) flowMap[flow.fromSubsidiary] = {};
    flowMap[flow.fromSubsidiary][flow.toSubsidiary] =
      (flowMap[flow.fromSubsidiary]?.[flow.toSubsidiary] ?? 0) + flow.amount;
  }

  const results: NettingResult[] = [];
  const processed = new Set<string>();

  for (const from of Object.keys(flowMap)) {
    for (const to of Object.keys(flowMap[from] ?? {})) {
      // Use sorted pair as dedup key so we process each pair once
      const pairKey = [from, to].sort().join('|');
      if (processed.has(pairKey)) continue;
      processed.add(pairKey);

      const forwardAmount = flowMap[from]?.[to] ?? 0;
      const reverseAmount = flowMap[to]?.[from] ?? 0;
      const grossAmount   = forwardAmount + reverseAmount;
      const netAmount     = Math.abs(forwardAmount - reverseAmount);

      // Net direction: the party with the larger obligation pays the difference
      const netFrom = forwardAmount >= reverseAmount ? from : to;
      const netTo   = forwardAmount >= reverseAmount ? to : from;

      // Count how many individual transactions can be avoided via netting.
      // Each matching transaction on both sides eliminates one wire.
      const forwardTxCount = flows.filter(
        f => f.fromSubsidiary === from && f.toSubsidiary === to,
      ).length;
      const reverseTxCount = flows.filter(
        f => f.fromSubsidiary === to && f.toSubsidiary === from,
      ).length;
      const transactionsAvoided = Math.min(forwardTxCount, reverseTxCount);
      const feesSavedUsd        = transactionsAvoided * 25; // $25 per wire avoided

      const pendingFlows = flows.filter(
        f =>
          (f.fromSubsidiary === from && f.toSubsidiary === to) ||
          (f.fromSubsidiary === to   && f.toSubsidiary === from),
      );

      results.push({
        fromSubsidiary: netFrom,
        toSubsidiary:   netTo,
        grossAmount,
        netAmount,
        feesSavedUsd,
        pendingFlows,
      });
    }
  }

  // Sort by netAmount descending so largest settlements appear first
  return results.sort((a, b) => b.netAmount - a.netAmount);
}

/**
 * Returns aggregate netting statistics across all subsidiary pairs.
 */
export function getNettingSummary(): {
  totalGrossUsd: number;
  totalNetUsd: number;
  totalFeesSavedUsd: number;
  reductionPercent: number;
  pairsCount: number;
  flowsCount: number;
} {
  const results = calculateNetting();

  const totalGrossUsd    = results.reduce((s, r) => s + r.grossAmount, 0);
  const totalNetUsd      = results.reduce((s, r) => s + r.netAmount, 0);
  const totalFeesSavedUsd = results.reduce((s, r) => s + r.feesSavedUsd, 0);
  const reductionPercent = totalGrossUsd > 0
    ? Math.round(((totalGrossUsd - totalNetUsd) / totalGrossUsd) * 100)
    : 0;

  return {
    totalGrossUsd,
    totalNetUsd,
    totalFeesSavedUsd,
    reductionPercent,
    pairsCount:  results.length,
    flowsCount:  flows.length,
  };
}

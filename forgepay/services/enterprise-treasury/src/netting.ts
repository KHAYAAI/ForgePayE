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
 * Persistence: when DATABASE_URL is set, flows write through to netting_flows
 * and completed settlement batches are recorded in netting_settlements.
 */

import { NettingFlow, NettingResult } from './types';
import { pool } from './db';

// ── Internal type: NettingFlow with optional DB id ────────────────────────────

interface TrackedFlow extends NettingFlow {
  _id?: string;
}

// In-memory flow store — fast-path for calculations
const flows: TrackedFlow[] = [];
let useDb = false;

// ── DB helpers ────────────────────────────────────────────────────────────────

const nextFlowId = (): string =>
  `nf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

async function persistFlow(flow: TrackedFlow): Promise<void> {
  if (!useDb || !flow._id) return;
  await pool.query(
    `INSERT INTO netting_flows (id, from_subsidiary, to_subsidiary, amount_usd, currency, invoice_ref, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING`,
    [flow._id, flow.fromSubsidiary, flow.toSubsidiary, flow.amount, flow.currency, flow.invoiceRef ?? null, flow.dueDate],
  ).catch((err: Error) => console.warn('[netting] DB persist flow failed:', err.message));
}

async function markFlowsSettled(ids: string[]): Promise<void> {
  if (!useDb || ids.length === 0) return;
  await pool.query(
    `UPDATE netting_flows SET settled = true WHERE id = ANY($1::text[])`,
    [ids],
  ).catch((err: Error) => console.warn('[netting] DB mark settled failed:', err.message));
}

async function persistSettlement(
  instructions: SettlementInstruction[],
  summary: ReturnType<typeof getNettingSummary>,
): Promise<void> {
  if (!useDb) return;
  const id = `set_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(
    `INSERT INTO netting_settlements (id, total_gross_usd, total_net_usd, fees_saved_usd, flow_count, instructions)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, summary.totalGrossUsd, summary.totalNetUsd, summary.totalFeesSavedUsd, summary.flowsCount, JSON.stringify(instructions)],
  ).catch((err: Error) => console.warn('[netting] DB persist settlement failed:', err.message));
}

// ── Startup initialiser ───────────────────────────────────────────────────────

export async function initFlowsFromDb(): Promise<void> {
  if (!process.env['DATABASE_URL']) return;
  try {
    const res = await pool.query<{
      id: string; from_subsidiary: string; to_subsidiary: string;
      amount_usd: string; currency: string; invoice_ref: string | null; due_date: string;
    }>(`SELECT * FROM netting_flows WHERE settled = false ORDER BY created_at`);
    flows.length = 0;
    for (const row of res.rows) {
      flows.push({
        _id:            row.id,
        fromSubsidiary: row.from_subsidiary,
        toSubsidiary:   row.to_subsidiary,
        amount:         Number(row.amount_usd),
        currency:       row.currency,
        invoiceRef:     row.invoice_ref ?? undefined,
        dueDate:        row.due_date,
      });
    }
    useDb = true;
    console.info(`[netting] Loaded ${flows.length} pending flows from DB`);
  } catch (err) {
    console.warn('[netting] DB unavailable, using in-memory store:', (err as Error).message);
  }
}

// ── Flow management ───────────────────────────────────────────────────────────

export function addFlow(flow: NettingFlow): void {
  const tracked: TrackedFlow = { ...flow, _id: nextFlowId() };
  flows.push(tracked);
  void persistFlow(tracked);
}

export function listFlows(): NettingFlow[] {
  return flows.map(({ _id: _, ...f }) => f);
}

export function clearSettledFlows(): void {
  const ids = flows.map(f => f._id).filter((id): id is string => !!id);
  flows.length = 0;
  void markFlowsSettled(ids);
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
      const forwardTxCount = flows.filter(
        f => f.fromSubsidiary === from && f.toSubsidiary === to,
      ).length;
      const reverseTxCount = flows.filter(
        f => f.fromSubsidiary === to && f.toSubsidiary === from,
      ).length;
      const transactionsAvoided = Math.min(forwardTxCount, reverseTxCount);
      const feesSavedUsd        = transactionsAvoided * 25; // $25 per wire avoided

      const pendingFlows = flows
        .filter(
          f =>
            (f.fromSubsidiary === from && f.toSubsidiary === to) ||
            (f.fromSubsidiary === to   && f.toSubsidiary === from),
        )
        .map(({ _id: _, ...f }) => f);

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

// ── Settlement instruction generation ─────────────────────────────────────────

export interface SettlementInstruction {
  id:             string;
  fromSubsidiary: string;
  toSubsidiary:   string;
  amountUsd:      number;
  currency:       string;
  method:         'wire' | 'stablecoin';
  reference:      string;
  invoiceRefs:    string[];
  dueDate:        string;
  status:         'pending' | 'dispatched' | 'confirmed' | 'failed';
  dispatchedAt?:  string;
  bankConnectivityRef?: string;
}

const settlementHistory: SettlementInstruction[] = [];

/**
 * Generates settlement instructions from the current netting results.
 * Each non-zero net obligation becomes one instruction.
 * Default method is 'wire'; instructions over $1M use 'stablecoin' for faster settlement.
 */
export function generateSettlementInstructions(): SettlementInstruction[] {
  const results = calculateNetting();
  const instructions: SettlementInstruction[] = [];

  for (const r of results) {
    if (r.netAmount < 0.01) continue; // Skip dust / zero balances

    const pairFlows = r.pendingFlows;
    const invoiceRefs = pairFlows
      .map(f => f.invoiceRef)
      .filter((ref): ref is string => typeof ref === 'string');

    const earliestDueDate = pairFlows.reduce(
      (earliest, f) => (f.dueDate < earliest ? f.dueDate : earliest),
      pairFlows[0]?.dueDate ?? new Date().toISOString().slice(0, 10),
    );

    instructions.push({
      id:             `set_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromSubsidiary: r.fromSubsidiary,
      toSubsidiary:   r.toSubsidiary,
      amountUsd:      Math.round(r.netAmount * 100) / 100,
      currency:       pairFlows[0]?.currency ?? 'USD',
      method:         r.netAmount >= 1_000_000 ? 'stablecoin' : 'wire',
      reference:      `NET-${r.fromSubsidiary}-${r.toSubsidiary}-${new Date().toISOString().slice(0, 10)}`,
      invoiceRefs,
      dueDate:        earliestDueDate,
      status:         'pending',
    });
  }

  return instructions;
}

/**
 * Dispatches settlement instructions to bank-connectivity for execution.
 * Persists the completed settlement batch to netting_settlements.
 * Returns the instructions with updated status. Failures are recorded but don't throw.
 */
export async function dispatchSettlementInstructions(
  instructions: SettlementInstruction[],
  bankConnectivityUrl: string,
): Promise<SettlementInstruction[]> {
  for (const instr of instructions) {
    try {
      const endpoint = instr.method === 'wire'
        ? `${bankConnectivityUrl}/v1/transfers/wire`
        : `${bankConnectivityUrl}/v1/transfers/stablecoin`;

      const resp = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-source': 'enterprise-treasury' },
        body:    JSON.stringify({
          from:        instr.fromSubsidiary,
          to:          instr.toSubsidiary,
          amountUsd:   instr.amountUsd,
          currency:    instr.currency,
          reference:   instr.reference,
          invoiceRefs: instr.invoiceRefs,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (resp.ok) {
        const body = (await resp.json()) as { transferId?: string };
        instr.status               = 'dispatched';
        instr.dispatchedAt         = new Date().toISOString();
        instr.bankConnectivityRef  = body.transferId;
      } else {
        instr.status = 'failed';
      }
    } catch {
      instr.status = 'failed';
    }

    settlementHistory.push(instr);
  }

  // Persist this settlement batch to DB (best-effort)
  const summary = getNettingSummary();
  void persistSettlement(instructions, summary);

  return instructions;
}

export function getSettlementHistory(limit = 50): SettlementInstruction[] {
  return settlementHistory.slice(-Math.min(limit, 500));
}

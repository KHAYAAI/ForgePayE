/**
 * Escrow ledger — real, stateful internal balance accounting for
 * agent-negotiation.
 *
 * This is a genuine ledger, not a stub: every agent has a tracked USD
 * balance, held in an in-memory Map that is the source of truth for a
 * running instance (matching the idiom used by forge-custody and
 * enterprise-treasury), mirrored to Postgres best-effort via persistAsync()
 * in db.ts. It enforces:
 *   - no negative balances — a lock (fund) is rejected outright if the
 *     funding agent's tracked balance is insufficient
 *   - idempotent terminal transitions — an escrow can be released XOR
 *     refunded exactly once; escrow.ts's status guard (only a 'funded'
 *     escrow may be released or refunded) prevents double-pay
 *   - a full audit trail — every balance mutation is recorded as a
 *     LedgerEntry with action, escrow id, from/to agent, amount, and
 *     timestamp (see getLedgerEntries)
 *
 * What this is NOT: on-chain settlement. Balances here are an internal IOU
 * ledger scoped entirely to this service. Real funding currently only
 * happens through the admin/test-only deposit() function below (exposed as
 * POST /v1/agents/:agentId/balance/deposit) — there is no code path that
 * moves real USDC/USDT yet. Wiring actual on-chain movement (via FORGE
 * Wallet, or a future stablecoin-gateway escrow API) is the next
 * integration step. See escrow.ts's module comment for the same note.
 */

import { randomUUID } from 'node:crypto';
import { persistAsync } from './db';
import type { LedgerAction, LedgerEntry } from './types';

// ── In-memory state (source of truth for a running instance) ─────────────────

const balances = new Map<string, number>();
const entries: LedgerEntry[] = [];

// ── Internal helpers ──────────────────────────────────────────────────────────

function record(action: LedgerAction, opts: {
  escrowId: string | null;
  fromAgentId: string | null;
  toAgentId: string | null;
  amountUsd: number;
}): LedgerEntry {
  const entry: LedgerEntry = {
    id:          randomUUID(),
    action,
    escrowId:    opts.escrowId,
    fromAgentId: opts.fromAgentId,
    toAgentId:   opts.toAgentId,
    amountUsd:   opts.amountUsd,
    createdAt:   new Date().toISOString(),
  };
  entries.push(entry);
  persistAsync(
    `INSERT INTO negotiation_ledger_entries
       (id, action, escrow_id, from_agent_id, to_agent_id, amount_usd, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO NOTHING`,
    [entry.id, entry.action, entry.escrowId, entry.fromAgentId, entry.toAgentId, entry.amountUsd, entry.createdAt],
  );
  return entry;
}

function persistBalance(agentId: string): void {
  persistAsync(
    `INSERT INTO negotiation_agent_balances (agent_id, balance_usd, updated_at)
     VALUES ($1,$2,NOW())
     ON CONFLICT (agent_id) DO UPDATE SET balance_usd = EXCLUDED.balance_usd, updated_at = NOW()`,
    [agentId, balances.get(agentId) ?? 0],
  );
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export function getBalance(agentId: string): number {
  return balances.get(agentId) ?? 0;
}

/** Full audit trail, oldest first. Pass an agentId to filter to entries that touched that agent. */
export function getLedgerEntries(agentId?: string): LedgerEntry[] {
  const all = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!agentId) return all;
  return all.filter((e) => e.fromAgentId === agentId || e.toAgentId === agentId);
}

// ── Deposit (admin/test/internal — see module comment) ────────────────────────

export interface DepositResult {
  agentId:    string;
  balanceUsd: number;
  entry:      LedgerEntry;
}

/**
 * Credits an agent's internal ledger balance. Real on-chain funding is not
 * wired yet — this exists so the escrow ledger (lock/release/refund) is
 * testable end-to-end. Treat as an admin/test/internal operation only; it
 * intentionally has no notion of "where the money came from" beyond the
 * ledger itself.
 */
export function deposit(agentId: string, amountUsd: number): DepositResult {
  const next = getBalance(agentId) + amountUsd;
  balances.set(agentId, next);
  const entry = record('deposit', { escrowId: null, fromAgentId: null, toAgentId: agentId, amountUsd });
  persistBalance(agentId);
  return { agentId, balanceUsd: next, entry };
}

// ── Lock (fund escrow) ─────────────────────────────────────────────────────────

export type LockResult =
  | { ok: true; entry: LedgerEntry }
  | { ok: false; error: string };

/**
 * Debits fromAgentId's balance to fund an escrow. Rejects cleanly — no
 * mutation occurs — if the balance is insufficient. Balances never go
 * negative.
 */
export function lock(escrowId: string, fromAgentId: string, amountUsd: number): LockResult {
  const current = getBalance(fromAgentId);
  if (current < amountUsd) {
    return {
      ok:    false,
      error: `Insufficient balance for agent ${fromAgentId}: has ${current.toFixed(2)}, needs ${amountUsd.toFixed(2)}`,
    };
  }
  balances.set(fromAgentId, current - amountUsd);
  const entry = record('lock', { escrowId, fromAgentId, toAgentId: null, amountUsd });
  persistBalance(fromAgentId);
  return { ok: true, entry };
}

// ── Release / Refund (credit out of escrow custody) ───────────────────────────

/** Credits toAgentId (the seller) from escrow custody on a successful negotiation. */
export function release(escrowId: string, toAgentId: string, amountUsd: number): LedgerEntry {
  balances.set(toAgentId, getBalance(toAgentId) + amountUsd);
  const entry = record('release', { escrowId, fromAgentId: null, toAgentId, amountUsd });
  persistBalance(toAgentId);
  return entry;
}

/** Credits toAgentId (the original funder) back from escrow custody. */
export function refund(escrowId: string, toAgentId: string, amountUsd: number): LedgerEntry {
  balances.set(toAgentId, getBalance(toAgentId) + amountUsd);
  const entry = record('refund', { escrowId, fromAgentId: null, toAgentId, amountUsd });
  persistBalance(toAgentId);
  return entry;
}

// ── Test/dev helper ────────────────────────────────────────────────────────────

/** Clears all in-memory ledger state. Test-only. */
export function resetLedger(): void {
  balances.clear();
  entries.length = 0;
}

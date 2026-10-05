/**
 * Escrow management — create, fund, release, refund, and dispute escrows
 * linked to negotiation sessions.
 *
 * fund/release/refund are backed by a REAL internal ledger (see ledger.ts):
 * agents hold a tracked USD balance in this service, funding an escrow debits
 * the buyer's balance (rejecting cleanly on insufficient funds — no negative
 * balances), and release/refund credit the counterparty exactly once each,
 * enforced by the status guards below (only a 'funded' escrow may transition
 * to 'released' or 'refunded', so double-release / double-refund / release-
 * after-refund / refund-after-release all fail cleanly rather than double-pay).
 *
 * What this does NOT do: move real money on-chain. The ledger is an internal
 * IOU system scoped to this service — balances are credited via the
 * admin/test-only deposit endpoint, not from any live USDC/USDT rail.
 * Integrating actual on-chain settlement (via FORGE Wallet, or a future
 * stablecoin-gateway escrow API — stablecoin-gateway currently exposes no
 * lock/release/refund endpoints at all) is the next integration step, not
 * yet wired.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Escrow } from './types';
import { getEscrow, setEscrow, getSession, setSession, memoryEscrow, putMemoryEscrow, rowToEscrow } from './store';
import { pool, isLedgerDbReady } from './db';
import { moveEscrow } from './ledger';

// ── Create Escrow ─────────────────────────────────────────────────────────────

export interface CreateEscrowOptions {
  sessionId:     string;
  buyerAgentId:  string;
  sellerAgentId: string;
  amountUsd:     number;
  asset:         Escrow['asset'];
  chain:         Escrow['chain'];
}

export async function createEscrow(opts: CreateEscrowOptions): Promise<Escrow | { error: string }> {
  const session = await getSession(opts.sessionId);
  if (!session) return { error: `Session ${opts.sessionId} not found` };

  const escrow: Escrow = {
    id:            uuidv4(),
    sessionId:     opts.sessionId,
    buyerAgentId:  opts.buyerAgentId,
    sellerAgentId: opts.sellerAgentId,
    amountUsd:     opts.amountUsd,
    asset:         opts.asset,
    chain:         opts.chain,
    status:        'pending',
    createdAt:     new Date().toISOString(),
  };

  await setEscrow(escrow);

  // Link escrow to session
  await setSession({ ...session, escrowId: escrow.id, updatedAt: new Date().toISOString() });

  return escrow;
}

// ── Fund Escrow ───────────────────────────────────────────────────────────────

export async function fundEscrow(escrowId: string): Promise<Escrow | { error: string }> {
  const r = await moveEscrow(escrowId, 'fund');
  return r.ok ? r.escrow : { error: r.error };
}

// ── Release Escrow ────────────────────────────────────────────────────────────

export async function releaseEscrow(escrowId: string, settlementTxId?: string): Promise<Escrow | { error: string }> {
  // Status check, seller credit and ledger entry are one atomic step in
  // ledger.moveEscrow, so a second (or concurrent) release cannot pay twice.
  const r = await moveEscrow(escrowId, 'release');
  if (!r.ok) return { error: r.error };

  const session = await getSession(r.escrow.sessionId);
  if (session && settlementTxId) {
    await setSession({ ...session, settlementTxId, status: 'settled', updatedAt: new Date().toISOString() });
  }
  return r.escrow;
}

// ── Refund Escrow ─────────────────────────────────────────────────────────────

export async function refundEscrow(escrowId: string, _reason: string): Promise<Escrow | { error: string }> {
  const r = await moveEscrow(escrowId, 'refund');
  return r.ok ? r.escrow : { error: r.error };
}

// ── Dispute Escrow ────────────────────────────────────────────────────────────

export async function disputeEscrow(escrowId: string, reason: string): Promise<Escrow | { error: string }> {
  let updated: Escrow | undefined;
  if (isLedgerDbReady()) {
    // Conditional, so a dispute cannot land on an escrow that was released
    // or refunded a moment earlier.
    const r = await pool.query<Record<string, unknown>>(
      `UPDATE negotiation_escrows SET status = 'disputed', dispute_reason = $2
       WHERE id = $1 AND status IN ('pending', 'funded') RETURNING *`, [escrowId, reason]);
    if (r.rowCount === 1) updated = rowToEscrow(r.rows[0]!);
  } else {
    const escrow = memoryEscrow(escrowId);
    if (escrow && (escrow.status === 'pending' || escrow.status === 'funded')) {
      updated = { ...escrow, status: 'disputed', disputeReason: reason };
      putMemoryEscrow(updated);
    }
  }
  if (!updated) {
    const escrow = await getEscrow(escrowId);
    if (!escrow) return { error: `Escrow ${escrowId} not found` };
    return { error: `Escrow cannot be disputed — current status: ${escrow.status}` };
  }

  const session = await getSession(updated.sessionId);
  if (session) {
    await setSession({ ...session, status: 'disputed', updatedAt: new Date().toISOString() });
  }
  return updated;
}

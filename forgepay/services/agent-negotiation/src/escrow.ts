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
import { getEscrow, setEscrow, getSession, setSession } from './store';
import { lock as lockLedger, release as releaseLedger, refund as refundLedger } from './ledger';

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
  const escrow = await getEscrow(escrowId);
  if (!escrow) return { error: `Escrow ${escrowId} not found` };
  if (escrow.status !== 'pending') {
    return { error: `Escrow cannot be funded — current status: ${escrow.status}` };
  }

  // Debit the buyer's tracked ledger balance. Rejects cleanly (no mutation,
  // no negative balance) if the buyer doesn't have enough — see ledger.ts.
  const lockResult = lockLedger(escrow.id, escrow.buyerAgentId, escrow.amountUsd);
  if (!lockResult.ok) {
    return { error: lockResult.error };
  }

  const updated: Escrow = {
    ...escrow,
    status:   'funded',
    fundedAt: new Date().toISOString(),
  };
  await setEscrow(updated);
  return updated;
}

// ── Release Escrow ────────────────────────────────────────────────────────────

export async function releaseEscrow(escrowId: string, settlementTxId?: string): Promise<Escrow | { error: string }> {
  const escrow = await getEscrow(escrowId);
  if (!escrow) return { error: `Escrow ${escrowId} not found` };
  // This status guard is what makes release idempotent: once an escrow has
  // moved to 'released' or 'refunded' it is no longer 'funded', so a second
  // release call (or a release after a refund) is rejected here — before any
  // ledger credit happens.
  if (escrow.status !== 'funded') {
    return { error: `Escrow cannot be released — current status: ${escrow.status}` };
  }

  // Credit the seller's tracked ledger balance from escrow custody.
  releaseLedger(escrow.id, escrow.sellerAgentId, escrow.amountUsd);

  const now     = new Date().toISOString();
  const updated: Escrow = {
    ...escrow,
    status:     'released',
    releasedAt: now,
  };
  await setEscrow(updated);

  // Update session with settlement tx
  const session = await getSession(escrow.sessionId);
  if (session && settlementTxId) {
    await setSession({ ...session, settlementTxId, status: 'settled', updatedAt: now });
  }

  return updated;
}

// ── Refund Escrow ─────────────────────────────────────────────────────────────

export async function refundEscrow(escrowId: string, reason: string): Promise<Escrow | { error: string }> {
  const escrow = await getEscrow(escrowId);
  if (!escrow) return { error: `Escrow ${escrowId} not found` };
  // Same idempotency guard as releaseEscrow: only a 'funded' escrow can be
  // refunded, so double-refund and refund-after-release are rejected here.
  if (escrow.status !== 'funded') {
    return { error: `Escrow cannot be refunded — current status: ${escrow.status}` };
  }

  // Credit the original funding agent's (buyer's) balance back from escrow custody.
  refundLedger(escrow.id, escrow.buyerAgentId, escrow.amountUsd);

  const updated: Escrow = {
    ...escrow,
    status:     'refunded',
    refundedAt: new Date().toISOString(),
  };
  await setEscrow(updated);
  return updated;
}

// ── Dispute Escrow ────────────────────────────────────────────────────────────

export async function disputeEscrow(escrowId: string, reason: string): Promise<Escrow | { error: string }> {
  const escrow = await getEscrow(escrowId);
  if (!escrow) return { error: `Escrow ${escrowId} not found` };
  if (escrow.status === 'released' || escrow.status === 'refunded') {
    return { error: `Escrow cannot be disputed — already in terminal state: ${escrow.status}` };
  }

  const updated: Escrow = {
    ...escrow,
    status:        'disputed',
    disputeReason: reason,
  };
  await setEscrow(updated);

  // Mark session as disputed too
  const session = await getSession(escrow.sessionId);
  if (session) {
    await setSession({ ...session, status: 'disputed', updatedAt: new Date().toISOString() });
  }

  return updated;
}

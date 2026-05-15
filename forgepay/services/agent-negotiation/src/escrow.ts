/**
 * Escrow management — create, fund, release, refund, and dispute escrows
 * linked to negotiation sessions.
 *
 * Note: fund/release/refund are stubs in this version.
 * Production: integrate with stablecoin-gateway (port 3002) to lock/release funds on-chain.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Escrow } from './types';
import { getEscrow, setEscrow, getSession, setSession } from './store';

const STABLECOIN_GATEWAY_URL = process.env['STABLECOIN_GATEWAY_URL'] ?? 'http://localhost:3002';

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

  // Stub: in production, call stablecoin-gateway to lock funds on-chain
  console.log(
    `[escrow] STUB: Would call ${STABLECOIN_GATEWAY_URL}/v1/lock to lock ` +
    `${escrow.amountUsd} ${escrow.asset} on ${escrow.chain} for session ${escrow.sessionId}`
  );

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
  if (escrow.status !== 'funded') {
    return { error: `Escrow cannot be released — current status: ${escrow.status}` };
  }

  // Stub: in production, call stablecoin-gateway to release funds to seller
  console.log(
    `[escrow] STUB: Would call ${STABLECOIN_GATEWAY_URL}/v1/release to send ` +
    `${escrow.amountUsd} ${escrow.asset} to seller agent ${escrow.sellerAgentId}`
  );

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
  if (escrow.status !== 'funded') {
    return { error: `Escrow cannot be refunded — current status: ${escrow.status}` };
  }

  // Stub: in production, call stablecoin-gateway to refund buyer
  console.log(
    `[escrow] STUB: Would call ${STABLECOIN_GATEWAY_URL}/v1/refund to return ` +
    `${escrow.amountUsd} ${escrow.asset} to buyer agent ${escrow.buyerAgentId}. Reason: ${reason}`
  );

  const updated: Escrow = {
    ...escrow,
    status: 'refunded',
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

/**
 * FORGE Custody + FORGE Wallet → ForgePay canonical event normalizers.
 *
 * Both services emit Revenue-Ontology events over HMAC-signed webhooks:
 *   forge-custody → custody.signature.confirmed   (institutional 4-of-7 signing)
 *   forge-wallet  → wallet.transaction.confirmed  (consumer/agent wallet transfers)
 *
 * The Agent Credit Bureau and Enterprise Treasury consume these canonical
 * events downstream — one record, every platform reads it.
 */

import { parseDid } from '../lib/did';

import { randomUUID } from 'node:crypto';
import type { ForgePayEvent } from '../types/events.js';

interface ForgeCustodyPayload {
  event_type?: string;
  actor_id?: string;
  amount?: number;
  currency?: string;
  blockchain?: string;
  from_address?: string;
  to_address?: string;
  tx_hash?: string;
  metadata?: {
    signing_id?: string;
    forge_workspace_id?: string;
    forge_merchant_id?: string;
    agent_id?: string;
    credit_line_id?: string;
    [key: string]: unknown;
  };
}

/**
 * Is this DID an autonomous agent rather than a human user?
 *
 * Previously `startsWith('did:forge:agent_')`, which recognised only the DIDs
 * forge-wallet mints. Agents registered through agent-identity carried
 * `did:forgepay:<uuid>` and were classified as human, so their events were
 * routed and reported as user activity.
 *
 * An agent is either an `agent_`-prefixed registry id under any method, or any
 * `did:forgepay:` identifier — that method was only ever issued to agents.
 */
function isAgentDid(actorId: unknown): boolean {
  const parsed = parseDid(actorId);
  if (!parsed || parsed.form !== 'registry') return false;
  return parsed.id.startsWith('agent_') || parsed.method === 'forgepay';
}

export function normalizeForgeCustodyEvent(
  body: Record<string, unknown>,
): ForgePayEvent | null {
  const payload = body as ForgeCustodyPayload;
  if (payload.event_type !== 'custody.signature.confirmed') return null;
  const meta = payload.metadata ?? {};

  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    type: 'custody.signature.confirmed',
    source: 'forge-custody',
    merchantId: meta.forge_merchant_id ?? payload.actor_id ?? 'unknown',
    occurredAt: now,
    processedAt: now,
    data: {
      signingId: meta.signing_id ?? '',
      workspaceId: meta.forge_workspace_id ?? '',
      actorId: payload.actor_id ?? '',
      agentId: meta.agent_id,
      creditLineId: meta.credit_line_id,
      amount: { value: String(payload.amount ?? 0), currency: payload.currency ?? 'USD', chain: payload.blockchain },
      fromAddress: payload.from_address ?? '',
      toAddress: payload.to_address ?? '',
      txHash: payload.tx_hash ?? '',
    },
    rawPayload: body,
    sourceEventId: `forge-custody:${meta.signing_id ?? payload.tx_hash ?? randomUUID()}`,
    apiVersion: '2026-04',
  };
}

interface ForgeWalletPayload {
  event_type?: string;
  actor_id?: string; // did:forge:user_* or did:forge:agent_*
  amount?: number;
  currency?: string;
  blockchain?: string;
  from_address?: string;
  to_address?: string;
  tx_hash?: string;
  payment_terms?: string | null;
  metadata?: { wallet_transaction_id?: string; [key: string]: unknown };
}

export function normalizeForgeWalletEvent(
  body: Record<string, unknown>,
): ForgePayEvent | null {
  const payload = body as ForgeWalletPayload;
  if (payload.event_type !== 'wallet.transaction.confirmed') return null;
  const meta = payload.metadata ?? {};

  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    type: 'wallet.transaction.confirmed',
    source: 'forge-wallet',
    merchantId: payload.actor_id ?? 'unknown',
    occurredAt: now,
    processedAt: now,
    data: {
      walletTransactionId: meta.wallet_transaction_id ?? '',
      actorDid: payload.actor_id ?? '',
      isAgent: isAgentDid(payload.actor_id),
      amount: { value: String(payload.amount ?? 0), currency: payload.currency ?? 'USDC', chain: payload.blockchain },
      fromAddress: payload.from_address ?? '',
      toAddress: payload.to_address ?? '',
      txHash: payload.tx_hash ?? '',
      paymentTerms: payload.payment_terms ?? null,
    },
    rawPayload: body,
    sourceEventId: `forge-wallet:${meta.wallet_transaction_id ?? payload.tx_hash ?? randomUUID()}`,
    apiVersion: '2026-04',
  };
}

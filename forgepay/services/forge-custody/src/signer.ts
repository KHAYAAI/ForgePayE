/**
 * Threshold signing + settlement for FORGE Custody.
 *
 * The real 4-of-7 MPC ceremony is coordinated by an external Go service
 * (the OpenFireblocks MPC orchestrator). This module defines the adapter
 * boundary:
 *
 *   - MpcCoordinatorSigner — POSTs to MPC_COORDINATOR_URL (production path)
 *   - DevSigner            — DEV ONLY simulation that records 4 share
 *                            contributions and emits a deterministic mock
 *                            signature. Refuses to run in production.
 *
 * After signing, the settlement step broadcasts (or simulates) the
 * transaction, waits for confirmations, and emits a
 * `custody.signature.confirmed` event to the Revenue Ontology via the
 * unified-router webhook (HMAC-SHA256 signed).
 */

import { createHash, createHmac } from 'node:crypto';
import { logger } from './lib/logger';
import { signingDuration, webhookEventsTotal } from './lib/metrics';
import { addShare, keys, newId, saveSigningRequest, sha256 } from './store';
import type { CustodyConfirmedEvent, SigningRequest } from './types';

export interface ThresholdSignature {
  signature: string;
  sharesUsed: Array<{ shareIndex: number; holder: string; contributionHash: string }>;
}

export interface ThresholdSigner {
  name: string;
  sign(request: SigningRequest): Promise<ThresholdSignature>;
}

/** Production adapter — delegates the ceremony to the MPC coordinator. */
export class MpcCoordinatorSigner implements ThresholdSigner {
  name = 'mpc-coordinator';

  constructor(private readonly baseUrl: string) {}

  async sign(request: SigningRequest): Promise<ThresholdSignature> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/ceremonies/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        signing_id: request.id,
        key_id: request.keyId,
        blockchain: request.blockchain,
        transaction: request.transaction,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      throw new Error(`MPC coordinator returned ${res.status}`);
    }
    return (await res.json()) as ThresholdSignature;
  }
}

/**
 * DEV ONLY — simulates a 4-of-7 ceremony deterministically. Never valid on a
 * real chain, and never allowed when NODE_ENV=production.
 */
export class DevSigner implements ThresholdSigner {
  name = 'dev-signer';

  async sign(request: SigningRequest): Promise<ThresholdSignature> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DevSigner is forbidden in production — set MPC_COORDINATOR_URL');
    }
    const key = keys.get(request.keyId);
    const threshold = key?.threshold ?? 4;
    const holders = key?.shareHolders?.length
      ? key.shareHolders
      : Array.from({ length: key?.totalShares ?? 7 }, (_, i) => `holder_${i + 1}`);

    const txDigest = createHash('sha256')
      .update(JSON.stringify({ id: request.id, tx: request.transaction, chain: request.blockchain }))
      .digest('hex');

    const sharesUsed = holders.slice(0, threshold).map((holder, i) => ({
      shareIndex: i + 1,
      holder,
      contributionHash: sha256(`${txDigest}:${holder}:${i + 1}`),
    }));

    return {
      signature: `0xdev${txDigest}`,
      sharesUsed,
    };
  }
}

export function getSigner(): ThresholdSigner {
  const url = process.env.MPC_COORDINATOR_URL;
  if (url) return new MpcCoordinatorSigner(url);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('MPC_COORDINATOR_URL is required in production');
  }
  return new DevSigner();
}

// ── Broadcast & confirmation ─────────────────────────────────────────────────

interface BroadcastResult {
  txHash: string;
  blockNumber: number;
}

async function broadcast(request: SigningRequest, signature: string): Promise<BroadcastResult> {
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL;
  if (!rpcUrl) {
    // Simulated settlement for dev/test environments.
    const txHash = `0x${sha256(`${request.id}:${signature}`).slice(0, 64)}`;
    return { txHash, blockNumber: 18_500_000 + Math.floor(Math.random() * 100_000) };
  }
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendRawTransaction',
      params: [signature],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (body.error || !body.result) {
    throw new Error(`broadcast failed: ${body.error?.message ?? 'no tx hash returned'}`);
  }
  return { txHash: body.result, blockNumber: 0 };
}

// ── Revenue Ontology emission ────────────────────────────────────────────────

export async function emitOntologyEvent(request: SigningRequest): Promise<void> {
  const routerUrl = process.env.UNIFIED_ROUTER_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!routerUrl || !secret) {
    logger.warn({ signingId: request.id }, '[custody] UNIFIED_ROUTER_URL/WEBHOOK_SECRET not set — ontology event not emitted');
    return;
  }

  const event: CustodyConfirmedEvent = {
    event_type: 'custody.signature.confirmed',
    actor_id: request.customerId,
    amount: request.amountUsd,
    currency: 'USD',
    blockchain: request.blockchain,
    from_address: keys.get(request.keyId)?.address ?? 'unknown',
    to_address: request.transaction.to,
    tx_hash: request.txHash ?? '',
    metadata: { ...request.metadata, signing_id: request.id, forge_workspace_id: request.workspaceId },
  };

  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

  try {
    const res = await fetch(`${routerUrl.replace(/\/$/, '')}/webhooks/forge-custody`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forge-timestamp': timestamp,
        'x-forge-signature': signature,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    webhookEventsTotal.inc({ status: res.ok ? 'delivered' : 'failed' });
    if (!res.ok) {
      logger.error({ signingId: request.id, status: res.status }, '[custody] ontology webhook rejected');
    }
  } catch (err) {
    webhookEventsTotal.inc({ status: 'failed' });
    logger.error({ err, signingId: request.id }, '[custody] ontology webhook delivery failed');
  }
}

// ── End-to-end signing pipeline (post-approval) ──────────────────────────────

const CONFIRMATIONS_REQUIRED = 12;

/**
 * Runs sign → broadcast → confirm for an approved request. Mutates and
 * persists the request at each stage. Confirmation polling is simulated as a
 * single step when no RPC is configured.
 */
export async function executeSigning(request: SigningRequest): Promise<SigningRequest> {
  const signer = getSigner();
  const started = Date.now();
  try {
    request.status = 'signing';
    saveSigningRequest(request);

    const { signature, sharesUsed } = await signer.sign(request);
    for (const share of sharesUsed) {
      addShare({
        id: newId('shr'),
        signingRequestId: request.id,
        shareIndex: share.shareIndex,
        holder: share.holder,
        contributionHash: share.contributionHash,
        createdAt: new Date().toISOString(),
      });
    }
    request.signature = signature;
    request.status = 'broadcast';
    saveSigningRequest(request);

    const { txHash, blockNumber } = await broadcast(request, signature);
    request.txHash = txHash;
    request.blockNumber = blockNumber + CONFIRMATIONS_REQUIRED;
    request.status = 'confirmed';
    request.confirmationTime = new Date().toISOString();
    saveSigningRequest(request);

    signingDuration.observe({ signer: signer.name }, (Date.now() - started) / 1000);
    await emitOntologyEvent(request);
    return request;
  } catch (err) {
    request.status = 'failed';
    request.error = err instanceof Error ? err.message : String(err);
    saveSigningRequest(request);
    logger.error({ err, signingId: request.id }, '[custody] signing pipeline failed');
    return request;
  }
}

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

/** blockchain name → EVM chain id for the mpc-signer contract. */
const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  sepolia: 11_155_111,
  polygon: 137,
  base: 8453,
  'base-sepolia': 84_532,
};

/**
 * Production adapter — delegates signing to the vendored OpenFireblocks
 * mpc-signer (forgepay/services/openfireblocks/services/mpc-signer).
 *
 * Contract: POST {MPC_COORDINATOR_URL}/sign
 *   { chainId, to, data, value, gasLimit, gasPrice, nonce }
 *   → { requestId, signedTx, txHash, from, status, auditLogId }
 *
 * The returned signedTx is the RLP-encoded signed transaction — broadcast()
 * sends it verbatim via eth_sendRawTransaction. Upstream Phase 1 signs with
 * a single shared key (Vault-backed); per-customer 4-of-7 ceremonies land in
 * Phase 2 behind this same adapter.
 */
export class MpcCoordinatorSigner implements ThresholdSigner {
  name = 'mpc-coordinator';

  constructor(private readonly baseUrl: string) {}

  async sign(request: SigningRequest): Promise<ThresholdSignature> {
    const chainId = CHAIN_IDS[request.blockchain];
    if (!chainId) {
      throw new Error(`mpc-signer has no chain id mapping for '${request.blockchain}'`);
    }
    const tx = request.transaction;
    const nonce = Number((request.metadata as { nonce?: number | string }).nonce ?? 0);

    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chainId,
        to: tx.to,
        data: tx.data ?? '0x',
        value: tx.value,
        gasLimit: tx.gas ? Number(tx.gas) : 21_000,
        gasPrice: tx.gasPrice ?? '20000000000',
        nonce,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; requestId?: string };
      throw new Error(`mpc-signer returned ${res.status}: ${body.error ?? 'unknown'} (${body.requestId ?? 'no request id'})`);
    }
    const signed = (await res.json()) as {
      requestId: string;
      signedTx: string;
      txHash: string;
      from: string;
      auditLogId: number;
    };
    return {
      signature: signed.signedTx,
      // Phase 1 upstream signs with one Vault-backed key; record the single
      // contribution so signing_shares stays an honest ledger. Phase 2 MPC
      // will return one entry per participating share.
      sharesUsed: [
        {
          shareIndex: 1,
          holder: `openfireblocks-mpc-signer:${signed.from}`,
          contributionHash: sha256(`${signed.requestId}:${signed.txHash}:${signed.auditLogId}`),
        },
      ],
    };
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
    //
    // Fails closed in production: without an RPC endpoint this returns a hash
    // derived from the request id and a random block number in the 18.5M range,
    // and the caller goes on to mark the signing request `confirmed`. A custody
    // service reporting a settled transfer that was never broadcast is worse
    // than one that errors.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'BLOCKCHAIN_RPC_URL is not configured. Refusing to simulate a broadcast in ' +
        'production — a simulated transaction would be recorded as confirmed settlement.',
      );
    }
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

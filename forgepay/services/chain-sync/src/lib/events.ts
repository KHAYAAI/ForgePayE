/**
 * Forward chain sync events to the unified-router.
 * The unified-router writes them to the canonical event log and fans them
 * out to merchant webhook endpoints.
 */

import { createHmac } from 'node:crypto';
import { config } from '../config.js';

// ── Event Types ───────────────────────────────────────────────────────────────

export interface MerkleRootUpdatedEvent {
  eventId:       string;
  type:          'chain.merkle_root_updated';
  chain:         string;
  version:       number;
  newRoot:       string;  // bytes32 hex
  prevRoot:      string;
  leafCount:     number;
  txHash:        string;
  blockNumber:   number;
  occurredAt:    string;
}

export interface NullifierSpentEvent {
  eventId:       string;
  type:          'chain.nullifier_spent';
  chain:         string;
  nullifier:     string;  // bytes32 hex
  merkleRoot:    string;
  amountUnits:   string;
  txHash:        string;
  blockNumber:   number;
  occurredAt:    string;
}

export interface NullifierFrozenEvent {
  eventId:       string;
  type:          'chain.nullifier_frozen';
  chain:         string;
  nullifier:     string;  // bytes32 hex
  auditor:       string;  // address
  reason:        string;
  txHash:        string;
  blockNumber:   number;
  occurredAt:    string;
}

export type ChainSyncEvent =
  | MerkleRootUpdatedEvent
  | NullifierSpentEvent
  | NullifierFrozenEvent;

// ── Event Forwarding ──────────────────────────────────────────────────────────

export async function forwardToUnifiedRouter(event: ChainSyncEvent): Promise<void> {
  const body      = JSON.stringify(event);
  const signature = createHmac('sha256', config.internalWebhookSecret)
    .update(body)
    .digest('hex');

  try {
    const res = await fetch(`${config.unifiedRouterUrl}/webhooks/chain-sync`, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-forgepay-sig':    `sha256=${signature}`,
        'x-forgepay-source': 'chain-sync',
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      console.error(
        `[chain-sync] Failed to forward ${event.type} to unified-router:`,
        res.status,
        await res.text().catch(() => '')
      );
    }
  } catch (err) {
    console.error(`[chain-sync] Error forwarding ${event.type}:`, err);
  }
}

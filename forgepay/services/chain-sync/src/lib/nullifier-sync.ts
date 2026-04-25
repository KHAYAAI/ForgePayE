/**
 * Nullifier Synchronizer
 *
 * Listens for PaymentConfirmed and NullifierFrozen events from NullifierRegistry
 * on each chain. On each event:
 *   1. Stores the event in chain_events table (PostgreSQL)
 *   2. Updates the mor-layer's shielded_checkout_sessions (marks nullifier as spent)
 *   3. Forwards event to unified-router for merchant webhook delivery
 *
 * ARCH: The NullifierRegistry contract is the canonical source of truth for
 * double-spending prevention. This service keeps the off-chain PostgreSQL nullifier
 * set in sync with the on-chain set.
 *
 * STUB: Contract addresses are all-zero in testing mode. Monitors will not connect.
 * TODO: Deploy contracts and update addresses in Helm values / env config.
 */

import { ethers } from 'ethers';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { forwardToUnifiedRouter } from './events.js';
import { withAutoReconnect } from './reconnect.js';
import type { ChainConfig } from '../config.js';

// Minimal ABI for NullifierRegistry events we listen to
const NULLIFIER_REGISTRY_ABI = [
  'event PaymentConfirmed(bytes32 indexed nullifier, bytes32 indexed merkleRoot, address indexed caller, uint256 amountUnits, uint256 timestamp)',
  'event NullifierFrozen(bytes32 indexed nullifier, address indexed auditor, string reason, uint256 timestamp)',
  'function isSpent(bytes32 nullifier) view returns (bool)',
];

// Sentinel nullifier used for periodic health checks (all-zeros = never a real nullifier).
const HEALTH_CHECK_NULLIFIER =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

// How long without an event before we issue a health-check probe (ms).
const HEALTH_CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

export async function startNullifierSync(
  chain: string,
  chainConfig: ChainConfig,
  db: Pool,
): Promise<void> {
  if (!chainConfig.rpcUrl) {
    console.warn(`[chain-sync] No RPC URL for ${chain} — nullifier-sync skipped`);
    return;
  }

  if (chainConfig.nullifierRegistryAddr === '0x0000000000000000000000000000000000000000') {
    console.warn(
      `[chain-sync] NullifierRegistry not deployed on ${chain} — nullifier-sync skipped (STUB)`,
    );
    return;
  }

  // withAutoReconnect ensures the monitor restarts if the provider drops.
  await withAutoReconnect(`nullifier-sync/${chain}`, () =>
    runNullifierMonitor(chain, chainConfig, db),
  );
}

async function runNullifierMonitor(
  chain: string,
  chainConfig: ChainConfig,
  db: Pool,
): Promise<void> {
  const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);

  // Verify the provider is reachable before attaching listeners.
  await provider.getBlockNumber();

  const registry = new ethers.Contract(
    chainConfig.nullifierRegistryAddr,
    NULLIFIER_REGISTRY_ABI,
    provider,
  );

  console.log(
    `[chain-sync] Listening for nullifier events on ${chain} (${chainConfig.nullifierRegistryAddr})`,
  );

  // Track the last time we received an event to detect stalls.
  let lastEventAt = Date.now();

  // Throw on provider errors to trigger the withAutoReconnect restart loop.
  provider.on('error', (err: unknown) => {
    console.error(`[chain-sync] nullifier-sync/${chain}: provider error — will reconnect:`, err);
    throw err;
  });

  // Listen for PaymentConfirmed events
  registry.on(
    'PaymentConfirmed',
    async (
      nullifier:   string,
      merkleRoot:  string,
      caller:      string,
      amountUnits: bigint,
      timestamp:   bigint,
      eventObj:    ethers.EventLog,
    ) => {
      lastEventAt = Date.now();
      const txHash      = eventObj.transactionHash;
      const blockNumber = eventObj.blockNumber;

      console.log(
        `[chain-sync] Nullifier spent on ${chain}: ${nullifier.slice(0, 10)}... (tx: ${txHash})`,
      );

      // Store in chain_events table
      await db.query(
        `INSERT INTO chain_events
           (id, chain, block_number, tx_hash, event_type, nullifier, merkle_root, amount_units, occurred_at)
         VALUES ($1, $2, $3, $4, 'nullifier_spent', $5, $6, $7, to_timestamp($8))
         ON CONFLICT (chain, tx_hash, event_type) DO NOTHING`,
        [
          randomUUID(),
          chain,
          blockNumber,
          txHash,
          nullifier,
          merkleRoot,
          amountUnits.toString(),
          Number(timestamp),
        ],
      );

      // Mark associated checkout session as confirmed
      await db.query(
        `UPDATE checkout_sessions
            SET status = 'completed', completed_at = to_timestamp($1)
          WHERE nullifier = $2
            AND is_shielded = true
            AND status = 'pending'`,
        [Number(timestamp), nullifier],
      );

      // Forward to unified-router
      await forwardToUnifiedRouter({
        eventId:     randomUUID(),
        type:        'chain.nullifier_spent',
        chain,
        nullifier,
        merkleRoot,
        amountUnits: amountUnits.toString(),
        txHash,
        blockNumber,
        occurredAt:  new Date(Number(timestamp) * 1000).toISOString(),
      });
    },
  );

  // Listen for NullifierFrozen events (auditor enforcement)
  registry.on(
    'NullifierFrozen',
    async (
      nullifier:  string,
      auditor:    string,
      reason:     string,
      timestamp:  bigint,
      eventObj:   ethers.EventLog,
    ) => {
      lastEventAt = Date.now();
      const txHash      = eventObj.transactionHash;
      const blockNumber = eventObj.blockNumber;

      console.warn(
        `[chain-sync] Nullifier FROZEN on ${chain}: ${nullifier.slice(0, 10)}... ` +
        `auditor=${auditor.slice(0, 8)}... reason="${reason}" (tx: ${txHash})`,
      );

      // Store in chain_events table
      await db.query(
        `INSERT INTO chain_events
           (id, chain, block_number, tx_hash, event_type, nullifier, reason, occurred_at)
         VALUES ($1, $2, $3, $4, 'nullifier_frozen', $5, $6, to_timestamp($7))
         ON CONFLICT (chain, tx_hash, event_type) DO NOTHING`,
        [
          randomUUID(),
          chain,
          blockNumber,
          txHash,
          nullifier,
          reason,
          Number(timestamp),
        ],
      );

      // Block any pending checkout sessions with this nullifier
      await db.query(
        `UPDATE checkout_sessions
            SET status = 'frozen', failure_reason = $1
          WHERE nullifier = $2
            AND is_shielded = true
            AND status = 'pending'`,
        [`Frozen by auditor: ${reason}`, nullifier],
      );

      // Forward to unified-router
      await forwardToUnifiedRouter({
        eventId:    randomUUID(),
        type:       'chain.nullifier_frozen',
        chain,
        nullifier,
        auditor,
        reason,
        txHash,
        blockNumber,
        occurredAt: new Date(Number(timestamp) * 1000).toISOString(),
      });
    },
  );

  // Periodic health check: poll isSpent() for the sentinel nullifier to verify
  // the provider connection is still alive.  If the call fails, throw to trigger
  // reconnection via withAutoReconnect.
  await new Promise<never>((_, reject) => {
    const timer = setInterval(async () => {
      const elapsed = Date.now() - lastEventAt;
      if (elapsed < HEALTH_CHECK_INTERVAL_MS) return;

      console.log(
        `[chain-sync] nullifier-sync/${chain}: no events for ${Math.round(elapsed / 1000)}s — probing isSpent()`,
      );
      try {
        await registry.isSpent(HEALTH_CHECK_NULLIFIER) as boolean;
        console.log(`[chain-sync] nullifier-sync/${chain}: health probe ok`);
        lastEventAt = Date.now(); // reset clock after successful probe
      } catch (err) {
        clearInterval(timer);
        reject(
          new Error(
            `[chain-sync] nullifier-sync/${chain}: health probe failed — reconnecting: ${err}`,
          ),
        );
      }
    }, HEALTH_CHECK_INTERVAL_MS);

    // Allow the process to exit even if this interval is still running.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as NodeJS.Timeout).unref();
    }
  });
}

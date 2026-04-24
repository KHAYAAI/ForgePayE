/**
 * Shielded deposit monitor.
 *
 * Polls the NullifierRegistry smart contract for PaymentConfirmed events
 * and matches them to pending shielded deposits in the database. On match,
 * marks the deposit as confirmed and forwards a shielded.payment.confirmed
 * event to the unified-router.
 *
 * Also listens for NullifierFrozen events (auditor compliance freeze) and
 * marks affected deposits as frozen.
 *
 * Poll interval: config.shielded.monitorIntervalMs (default 30 seconds).
 *
 * STUB MODE: NullifierRegistry contract addresses are all-zero until Phase 3
 * contracts are deployed to testnets. The monitor skips chains where the
 * contract address is the zero address.
 *
 * TODO: Replace ethers.js polling with WebSocket subscriptions for lower
 * latency (Alchemy/Infura wss endpoints).
 */

import { ethers } from 'ethers';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { config } from '../config.js';
import { forwardToUnifiedRouter } from './events.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Minimal ABI for the events we care about from NullifierRegistry.sol
const NULLIFIER_REGISTRY_ABI = [
  'event PaymentConfirmed(bytes32 indexed nullifier, bytes32 indexed merkleRoot, address indexed verifier, uint256 blockNumber)',
  'event NullifierFrozen(bytes32 indexed nullifier, address indexed auditor, string reason)',
];

type SupportedChain = 'ethereum' | 'polygon' | 'base' | 'arbitrum';

export async function startShieldedMonitor(chain: SupportedChain, db: Pool): Promise<void> {
  const contractAddress = config.shielded.nullifierRegistry[chain];

  if (contractAddress === ZERO_ADDRESS) {
    console.log(`[shielded-monitor] Skipping ${chain}: NullifierRegistry not yet deployed (zero address)`);
    return;
  }

  const rpcUrl = (config.rpc as Record<string, string>)[chain];
  if (!rpcUrl) {
    console.warn(`[shielded-monitor] No RPC URL for chain ${chain}, skipping`);
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const registry  = new ethers.Contract(contractAddress, NULLIFIER_REGISTRY_ABI, provider);

  console.log(`[shielded-monitor] Watching NullifierRegistry on ${chain} (${contractAddress})`);

  // ── PaymentConfirmed: nullifier was spent on-chain → deposit confirmed ────
  registry.on(
    'PaymentConfirmed',
    async (nullifier: string, _merkleRoot: string, _verifier: string, blockNumber: bigint, event: ethers.EventLog) => {
      const txHash = event.transactionHash;
      console.log(`[shielded-monitor] PaymentConfirmed on ${chain}: nullifier=${nullifier} tx=${txHash}`);

      // Look up pending shielded deposit by nullifier
      const result = await db.query(
        `SELECT id, merchant_id, chain, token
           FROM shielded_deposits
          WHERE nullifier = $1 AND status IN ('pending', 'confirming')
          LIMIT 1`,
        [nullifier],
      );

      if (result.rows.length === 0) {
        // TODO: Could be an x402 shielded payment — check x402_shielded_payments table too
        const x402Result = await db.query(
          `SELECT id, merchant_id FROM x402_shielded_payments
            WHERE nullifier = $1 AND status IN ('pending', 'confirming') LIMIT 1`,
          [nullifier],
        );
        if (x402Result.rows.length > 0) {
          const payment = x402Result.rows[0] as { id: string; merchant_id: string };
          await db.query(
            `UPDATE x402_shielded_payments
                SET status = 'confirmed', confirmed_at = now(), tx_hash = $1
              WHERE id = $2`,
            [txHash, payment.id],
          );
          console.log(`[shielded-monitor] x402 shielded payment confirmed: ${payment.id}`);
        }
        return;
      }

      const deposit = result.rows[0] as { id: string; merchant_id: string; chain: string; token: string };

      await db.query(
        `UPDATE shielded_deposits
            SET status = 'confirmed', confirmed_at = now(), tx_hash = $1
          WHERE id = $2`,
        [txHash, deposit.id],
      );

      // Forward confirmation event to unified-router for merchant webhook delivery
      await forwardToUnifiedRouter({
        eventId:    randomUUID(),
        type:       'shielded.payment.confirmed',
        merchantId: deposit.merchant_id,
        depositId:  deposit.id,
        chain,
        token:      deposit.token as 'USDC' | 'USDT',
        nullifier,
        txHash,
        blockNumber: Number(blockNumber),
        occurredAt: new Date().toISOString(),
      } as any);

      console.log(`[shielded-monitor] Deposit confirmed: ${deposit.id}`);
    },
  );

  // ── NullifierFrozen: auditor compliance freeze ────────────────────────────
  registry.on(
    'NullifierFrozen',
    async (nullifier: string, _auditor: string, reason: string, event: ethers.EventLog) => {
      const txHash = event.transactionHash;
      console.log(`[shielded-monitor] NullifierFrozen on ${chain}: nullifier=${nullifier} reason=${reason}`);

      // Freeze matching deposits
      await db.query(
        `UPDATE shielded_deposits
            SET status = 'frozen', frozen_reason = $1, tx_hash = $2
          WHERE nullifier = $3 AND status NOT IN ('frozen', 'failed')`,
        [reason, txHash, nullifier],
      );

      // Also freeze matching x402 shielded payments
      await db.query(
        `UPDATE x402_shielded_payments
            SET status = 'frozen', frozen_reason = $1, tx_hash = $2
          WHERE nullifier = $3 AND status NOT IN ('frozen', 'failed')`,
        [reason, txHash, nullifier],
      );

      await forwardToUnifiedRouter({
        eventId:    randomUUID(),
        type:       'shielded.nullifier.frozen',
        chain,
        nullifier,
        reason,
        txHash,
        occurredAt: new Date().toISOString(),
      } as any);
    },
  );
}

// Interval-based fallback poll: re-query DB for deposits stuck in 'pending'
// that may have been missed by the event listener (e.g. due to RPC reconnect).
export function startShieldedRecoveryPoller(db: Pool): NodeJS.Timeout {
  const intervalMs = config.shielded.monitorIntervalMs;

  return setInterval(async () => {
    try {
      // Mark stale pending deposits as expired
      const expired = await db.query(
        `UPDATE shielded_deposits
            SET status = 'failed'
          WHERE status = 'pending'
            AND expires_at < now()
          RETURNING id, merchant_id, nullifier`,
      );
      for (const row of expired.rows as { id: string; merchant_id: string; nullifier: string }[]) {
        console.log(`[shielded-monitor] Expired shielded deposit: ${row.id}`);
        await forwardToUnifiedRouter({
          eventId:    randomUUID(),
          type:       'shielded.deposit.expired',
          merchantId: row.merchant_id,
          depositId:  row.id,
          nullifier:  row.nullifier,
          occurredAt: new Date().toISOString(),
        } as any);
      }
    } catch (err) {
      console.error('[shielded-monitor] Recovery poll error:', err);
    }
  }, intervalMs);
}

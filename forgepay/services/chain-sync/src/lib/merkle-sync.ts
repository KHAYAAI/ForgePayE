/**
 * Merkle Root Synchronizer
 *
 * Listens for RootUpdated events from the CommitmentTree contract on each chain.
 * On each update:
 *   1. Reads new root and version from the event
 *   2. Compares against ForgePay's internal Merkle root in PostgreSQL
 *   3. If diverged → logs alert, triggers investigation
 *   4. Forwards event to unified-router (fans out to merchant webhooks)
 *   5. Updates chain_events table
 *
 * ARCH: The CommitmentTree contract emits RootUpdated(version, newRoot, prevRoot, leafCount)
 * on every updateRoot() call. The unified-router service account is the only party
 * that can call updateRoot(), so this should only diverge if there's a bug or attack.
 *
 * STUB: Contract addresses are all-zero in testing mode. Monitors will not connect.
 * TODO: Deploy contracts and update addresses in Helm values / env config.
 */

import { ethers } from 'ethers';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { forwardToUnifiedRouter } from './events.js';
import type { ChainConfig } from '../config.js';

// Minimal ABI for CommitmentTree events we listen to
const COMMITMENT_TREE_ABI = [
  'event RootUpdated(uint256 indexed version, bytes32 indexed newRoot, bytes32 indexed prevRoot, uint256 leafCount, uint256 timestamp)',
  'function currentRoot() view returns (bytes32)',
  'function currentVersion() view returns (uint256)',
];

export async function startMerkleSync(
  chain: string,
  chainConfig: ChainConfig,
  db: Pool,
): Promise<void> {
  if (!chainConfig.rpcUrl) {
    console.warn(`[chain-sync] No RPC URL for ${chain} — merkle-sync skipped`);
    return;
  }

  if (chainConfig.commitmentTreeAddr === '0x0000000000000000000000000000000000000000') {
    console.warn(`[chain-sync] CommitmentTree not deployed on ${chain} — merkle-sync skipped (STUB)`);
    return;
  }

  const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
  const commitmentTree = new ethers.Contract(
    chainConfig.commitmentTreeAddr,
    COMMITMENT_TREE_ABI,
    provider,
  );

  console.log(`[chain-sync] Listening for Merkle root updates on ${chain} (${chainConfig.commitmentTreeAddr})`);

  commitmentTree.on(
    'RootUpdated',
    async (
      version:   bigint,
      newRoot:   string,
      prevRoot:  string,
      leafCount: bigint,
      timestamp: bigint,
      eventObj:  ethers.EventLog,
    ) => {
      const txHash      = eventObj.transactionHash;
      const blockNumber = eventObj.blockNumber;

      console.log(
        `[chain-sync] Merkle root updated on ${chain}: version=${version} root=${newRoot.slice(0, 10)}... (tx: ${txHash})`
      );

      // Store in chain_events table
      await db.query(
        `INSERT INTO chain_events
           (id, chain, block_number, tx_hash, event_type, version, new_root, prev_root, leaf_count, occurred_at)
         VALUES ($1, $2, $3, $4, 'merkle_root_updated', $5, $6, $7, $8, to_timestamp($9))
         ON CONFLICT (chain, tx_hash, event_type) DO NOTHING`,
        [
          randomUUID(),
          chain,
          blockNumber,
          txHash,
          version.toString(),
          newRoot,
          prevRoot,
          leafCount.toString(),
          Number(timestamp),
        ],
      );

      // Compare against off-chain state
      await checkMerkleRootDivergence(chain, version, newRoot, db);

      // Forward event to unified-router
      await forwardToUnifiedRouter({
        eventId:     randomUUID(),
        type:        'chain.merkle_root_updated',
        chain,
        version:     Number(version),
        newRoot,
        prevRoot,
        leafCount:   Number(leafCount),
        txHash,
        blockNumber,
        occurredAt:  new Date(Number(timestamp) * 1000).toISOString(),
      });
    },
  );
}

async function checkMerkleRootDivergence(
  chain: string,
  onChainVersion: bigint,
  onChainRoot: string,
  db: Pool,
): Promise<void> {
  const result = await db.query<{ current_root: string; version: string }>(
    `SELECT current_root, version
       FROM merkle_tree_state
      WHERE chain = $1
      LIMIT 1`,
    [chain],
  );

  if (result.rows.length === 0) {
    // First update for this chain — initialize the state
    await db.query(
      `INSERT INTO merkle_tree_state (chain, version, current_root, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (chain) DO UPDATE
         SET version = EXCLUDED.version,
             current_root = EXCLUDED.current_root,
             updated_at = now()`,
      [chain, onChainVersion.toString(), onChainRoot],
    );
    return;
  }

  const dbRoot    = result.rows[0].current_root;
  const dbVersion = BigInt(result.rows[0].version);

  if (dbVersion === onChainVersion && dbRoot !== onChainRoot) {
    // Critical divergence: same version but different root
    // This indicates a bug or attack — alert immediately
    console.error(
      `[chain-sync] ⚠️  MERKLE ROOT DIVERGENCE on ${chain}!` +
      ` version=${onChainVersion}` +
      ` on-chain=${onChainRoot.slice(0, 10)}...` +
      ` off-chain=${dbRoot.slice(0, 10)}...` +
      ` — Investigation required immediately.`
    );
    // TODO: Alert PagerDuty / Slack webhook here
  }

  // Update off-chain state to match on-chain
  await db.query(
    `INSERT INTO merkle_tree_state (chain, version, current_root, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (chain) DO UPDATE
       SET version = EXCLUDED.version,
           current_root = EXCLUDED.current_root,
           updated_at = now()`,
    [chain, onChainVersion.toString(), onChainRoot],
  );
}

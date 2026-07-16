/**
 * FORGE Mode 2 Settlement Worker
 * ──────────────────────────────────────────────────────────────────────────────
 * Runs as a background timer inside the agent-credit-bureau Fastify process.
 * Periodically settles Mode 1 (FICO) scores from the in-memory store to the
 * ForgeReputationRegistry smart contract on Base (Mode 2 on-chain record).
 *
 * Design: ASYNC SETTLEMENT (not synchronous per-request)
 *   - Mode 1 stays <15ms — no blockchain writes on the hot path
 *   - Mode 2 is settled daily at 20:00 UTC via batchUpdateScores()
 *   - Lenders reading /dual-score get live Mode 1 + last settled Mode 2
 *   - Divergence (>100pt variance) auto-flags for manual review
 *
 * Settlement receipt store:
 *   agentId → { txHash, blockNumber, chainId, settledAt, settledScore }
 *   Used by /dual-score to populate Mode2Score.txHash / .blockNumber
 *
 * Batch strategy:
 *   - Max 100 agents per on-chain batch call (ForgeReputationRegistry.MAX_BATCH_SIZE)
 *   - Agents are chunked: 1000 agents = 10 sequential batch txs
 *   - Unregistered agents are registered first (separate registerAgent calls)
 *   - Frozen agents are skipped (their score cannot be updated on-chain)
 *
 * Env vars:
 *   SETTLEMENT_INTERVAL_MS   — default 86400000 (24h). Set to 300000 for staging.
 *   SETTLEMENT_HOUR_UTC      — default 20 (8pm UTC). Only used if CRON_MODE=true.
 *   ETH_PRICE_USD            — used for wei→USD volume conversion in Mode2Inputs
 */

import { createHash } from 'crypto';
import type { Address } from 'viem';
import { getChainClient, didToAddress } from './chain';
import { profiles } from './store';
import { isDbEnabled, upsertSettlement, loadAllSettlements } from './db';

// ── Settlement receipt store (in-memory; survives process restart via re-settle) ──

export interface SettlementReceipt {
  agentId:      string;
  agentAddress: Address;
  settledScore: number;       // Mode 1 score at settlement time
  txHash:       `0x${string}`;
  blockNumber:  number;
  chainId:      number;
  settledAt:    string;       // ISO8601
}

const _receipts = new Map<string, SettlementReceipt>();

/** Store a receipt in the read-model and write it through to Postgres when enabled. */
function saveReceipt(r: SettlementReceipt): void {
  _receipts.set(r.agentId, r);
  if (isDbEnabled()) {
    upsertSettlement(r.agentId, r).catch((e) =>
      console.error('[credit-bureau] failed to persist settlement receipt:', e),
    );
  }
}

/** Hydrate settlement receipts from Postgres at startup. No-op without a database. */
export async function hydrateSettlements(): Promise<void> {
  if (!isDbEnabled()) return;
  const rows = await loadAllSettlements();
  for (const r of rows) _receipts.set(r.agentId, r);
  if (rows.length > 0) console.log(`[credit-bureau] hydrated ${rows.length} settlement receipts`);
}

export const getSettlementReceipt = (agentId: string) => _receipts.get(agentId);
export const listSettlementReceipts = () => Array.from(_receipts.values());

// ── Settlement statistics ─────────────────────────────────────────────────────

interface SettlementRun {
  startedAt:     string;
  completedAt?:  string;
  agentsTotal:   number;
  agentsSettled: number;
  agentsSkipped: number;
  agentsFailed:  number;
  txHashes:      `0x${string}`[];
  errors:        string[];
}

let _lastRun: SettlementRun | null = null;
let _runCount = 0;

export const getLastSettlementRun = () => _lastRun;
export const getSettlementRunCount = () => _runCount;

// ── Reason hash helpers ───────────────────────────────────────────────────────

function reasonHash(label: string): `0x${string}` {
  const hash = createHash('sha256').update(label).digest('hex');
  return `0x${hash}` as `0x${string}`;
}

const REASON_DAILY_SETTLEMENT  = reasonHash('FORGE_DAILY_MODE1_SETTLEMENT');
const REASON_MANUAL_SETTLEMENT = reasonHash('FORGE_MANUAL_SETTLEMENT');

// ── Core settlement function ──────────────────────────────────────────────────

/**
 * Run a full settlement pass:
 *   1. Collect all agent profiles from the in-memory store
 *   2. Map each DID to an on-chain address (did:fp:0x...)
 *   3. Register any agents not yet on-chain
 *   4. Skip frozen agents
 *   5. Batch-update scores in chunks of 100
 *   6. Store receipts for dual-score endpoint
 */
export async function runSettlement(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<SettlementRun> {
  const chain = getChainClient();
  const run: SettlementRun = {
    startedAt:     new Date().toISOString(),
    agentsTotal:   profiles.size,
    agentsSettled: 0,
    agentsSkipped: 0,
    agentsFailed:  0,
    txHashes:      [],
    errors:        [],
  };

  if (!chain) {
    run.completedAt = new Date().toISOString();
    run.errors.push('Chain client not configured — CHAIN_RPC_URL / SETTLEMENT_PRIVATE_KEY missing. Running in off-chain only mode.');
    _lastRun = run;
    return run;
  }

  const reason = trigger === 'manual' ? REASON_MANUAL_SETTLEMENT : REASON_DAILY_SETTLEMENT;
  const allProfiles = Array.from(profiles.values());

  // ── Step 1: resolve addresses, filter out unresolvable DIDs ─────────────────
  const candidates: { agentId: string; address: Address; score: number }[] = [];

  for (const p of allProfiles) {
    const addr = didToAddress(p.did);
    if (!addr) {
      run.agentsSkipped++;
      run.errors.push(`${p.agentId}: DID ${p.did} has no EVM address — skipped`);
      continue;
    }
    candidates.push({ agentId: p.agentId, address: addr, score: p.currentScore });
  }

  // ── Step 2: register any unregistered agents (one at a time, awaited) ────────
  for (const c of candidates) {
    try {
      const registered = await chain.isAgentRegistered(c.address);
      if (!registered) {
        const regTx = await chain.registerAgentOnChain(c.address);
        await chain.waitForReceipt(regTx);
      }
    } catch (err) {
      run.agentsFailed++;
      run.errors.push(`${c.agentId}: registration failed — ${String(err)}`);
    }
  }

  // ── Step 3: check frozen status, build final batch list ───────────────────
  const toSettle: { agentId: string; address: Address; score: number }[] = [];

  for (const c of candidates) {
    try {
      const frozen = await chain.isAgentFrozen(c.address);
      if (frozen) {
        run.agentsSkipped++;
        continue;
      }
      toSettle.push(c);
    } catch {
      run.agentsSkipped++;
    }
  }

  // ── Step 4: batch in chunks of 100 ────────────────────────────────────────
  // An agent may be frozen between Step 3 (our check) and the tx landing on-chain,
  // causing the entire batch to revert. On failure, fall back to 1-by-1 settlement
  // so a single frozen agent doesn't block the whole chunk.
  const BATCH_SIZE = 100;
  for (let i = 0; i < toSettle.length; i += BATCH_SIZE) {
    const chunk = toSettle.slice(i, i + BATCH_SIZE);

    const addresses = chunk.map(c => c.address);
    const scores    = chunk.map(c => c.score);
    const reasons   = chunk.map(() => reason);

    try {
      const txHash = await chain.batchSettleScores(addresses, scores, reasons);
      const receipt = await chain.waitForReceipt(txHash);

      for (const c of chunk) {
        saveReceipt({
          agentId:      c.agentId,
          agentAddress: c.address,
          settledScore: c.score,
          txHash,
          blockNumber:  Number(receipt.blockNumber),
          chainId:      chain.chainId,
          settledAt:    new Date().toISOString(),
        });
        run.agentsSettled++;
      }

      run.txHashes.push(txHash);
    } catch (batchErr) {
      // Batch failed — retry each agent individually to isolate frozen/invalid agents.
      run.errors.push(`Batch ${i / BATCH_SIZE + 1} failed (retrying 1-by-1): ${String(batchErr)}`);

      for (const c of chunk) {
        try {
          const txHash = await chain.batchSettleScores([c.address], [c.score], [reason]);
          const receipt = await chain.waitForReceipt(txHash);

          saveReceipt({
            agentId:      c.agentId,
            agentAddress: c.address,
            settledScore: c.score,
            txHash,
            blockNumber:  Number(receipt.blockNumber),
            chainId:      chain.chainId,
            settledAt:    new Date().toISOString(),
          });
          run.agentsSettled++;
          run.txHashes.push(txHash);
        } catch (singleErr) {
          run.agentsFailed++;
          run.errors.push(`${c.agentId}: individual settle failed — ${String(singleErr)}`);
        }
      }
    }
  }

  run.completedAt = new Date().toISOString();
  _lastRun = run;
  _runCount++;

  return run;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the daily settlement scheduler.
 * Default: every 24h. Set SETTLEMENT_INTERVAL_MS=300000 for 5-minute staging runs.
 */
export function startSettlementScheduler() {
  if (_timer) return; // already running

  const intervalMs = parseInt(process.env['SETTLEMENT_INTERVAL_MS'] ?? '86400000', 10);

  _timer = setInterval(async () => {
    try {
      const result = await runSettlement('scheduled');
      const settled = result.agentsSettled;
      const failed  = result.agentsFailed;
      const txs     = result.txHashes.length;
      console.info(
        `[settlement] run #${_runCount}: ${settled} settled, ${failed} failed, ${txs} txs ` +
        `(${result.completedAt})`
      );
    } catch (err) {
      console.error('[settlement] unhandled error:', err);
    }
  }, intervalMs);

  console.info(`[settlement] scheduler started — interval ${intervalMs}ms (${intervalMs / 3600000}h)`);
}

export function stopSettlementScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

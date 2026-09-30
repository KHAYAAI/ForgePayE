/**
 * Detecting and settling incoming payments.
 *
 * Replaces the event-subscription monitor. That one only ever watched
 * `stablecoin_deposits` (so an x402 payment, which had no deposit behind it, could
 * never confirm), assumed 6 decimals for everything, trusted whatever amount
 * arrived, missed anything paid while the process was down, and its ethers
 * subscriptions could reach the process-wide fatal handler on a flaky RPC.
 *
 * This is a poller. Each pass, for each open deposit, it reads the token's
 * Transfer logs to the deposit address and works out how much has arrived:
 *
 *   - Only *final* blocks (deeper than the chain's confirmation threshold) are
 *     added to the persisted total, advancing a cursor. A reorg can therefore
 *     never un-credit anything that was counted.
 *   - The few newest, not-yet-final blocks are looked at each pass but not
 *     persisted: enough to show 'confirming', and to fall back to 'pending' if the
 *     transfer is reorged away.
 *   - A transfer counts only if its block is no later than the deposit's expiry.
 *     Later ones are recorded in `late_units` for reconciliation and never credited.
 *   - It is compared against the units quoted, in *that asset's* decimals. Less
 *     than quoted is a partial payment, not a confirmation; more is confirmed.
 *
 * Because it works from the chain rather than from events, a restart or an outage
 * costs nothing: the next pass picks up where the cursor was. Every RPC call is
 * inside a try/catch — a bad endpoint fails one pass, never the process.
 */

import { ethers } from 'ethers';
import { randomUUID } from 'node:crypto';
import type { AssetRegistry, ChainAsset } from './assets.js';
import type { Queryable } from './deposit-open.js';
import { forwardToUnifiedRouter } from './events.js';

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

export interface ChainTransfer { txHash: string; blockNumber: number; value: bigint }

/** What settlement needs from a chain. Injectable so it can be tested without a network. */
export interface SettlementChain {
  blockNumber(): Promise<number>;
  transfersTo(token: string, to: string, fromBlock: number, toBlock: number): Promise<ChainTransfer[]>;
  blockTime(blockNumber: number): Promise<number>;
}

export class RpcSettlementChain implements SettlementChain {
  private times = new Map<number, number>();
  constructor(private readonly provider: ethers.JsonRpcProvider) {}
  blockNumber() { return this.provider.getBlockNumber(); }
  async transfersTo(token: string, to: string, fromBlock: number, toBlock: number) {
    const logs = await this.provider.getLogs({
      address: token, fromBlock, toBlock,
      topics: [TRANSFER_TOPIC, null, ethers.zeroPadValue(to, 32)],
    });
    return logs.map((l) => ({ txHash: l.transactionHash, blockNumber: l.blockNumber, value: BigInt(l.data) }));
  }
  async blockTime(n: number) {
    const hit = this.times.get(n);
    if (hit !== undefined) return hit;
    const b = await this.provider.getBlock(n);
    if (!b) throw new Error(`block ${n} not found`);
    if (this.times.size > 2000) this.times.clear();
    this.times.set(n, b.timestamp);
    return b.timestamp;
  }
}

export interface SettlementOptions {
  /** Block depth at which a transfer is final, per chain. */
  confirmations: (chain: string) => number;
  /** How long after expiry to keep looking before giving up on a deposit. */
  expiryGraceMs?: number;
  /** Blocks per eth_getLogs request (public RPCs cap this). */
  logWindow?: number;
  /** Used when a deposit has no starting block recorded. */
  defaultLookbackBlocks?: number;
  /** How long after expiry a deposit is still checked for late payments (default 48h). */
  lateWindowMs?: number;
  /** Run the late scan once every this many passes (default 30). */
  lateEveryPasses?: number;
  now?: () => Date;
}

interface DepositRow {
  id: string; merchant_id: string; address: string; chain: string; token: string;
  amount_units: string; amount_usd: string; decimals: number | null; status: string;
  from_block: string | null; scan_cursor: string | null; scan_units: string; late_units: string | null;
  received_amount_units: string | null; tx_hash: string | null; expires_at: Date;
}

export interface PassResult { checked: number; confirming: number; confirmed: number; expired: number; errors: number }

/** One pass over one chain. Exposed for tests; startSettlement calls it on a timer. */
export async function settleChainOnce(
  chain: string, chainApi: SettlementChain, db: Queryable, registry: AssetRegistry, opts: SettlementOptions,
): Promise<PassResult> {
  const now = (opts.now ?? (() => new Date()))();
  const result: PassResult = { checked: 0, confirming: 0, confirmed: 0, expired: 0, errors: 0 };
  const window = opts.logWindow ?? 2000;
  const grace = opts.expiryGraceMs ?? 5 * 60_000;
  const depth = Math.max(1, opts.confirmations(chain));

  const open = await db.query(
    `SELECT id, merchant_id, address, chain, token, amount_units, amount_usd, decimals, status, from_block,
            scan_cursor, scan_units, late_units, received_amount_units, tx_hash, expires_at
       FROM stablecoin_deposits
      WHERE chain = $1 AND status IN ('pending', 'confirming')
      ORDER BY created_at LIMIT 500`,
    [chain],
  );
  if (open.rows.length === 0) return result;

  const head = await chainApi.blockNumber();
  const finalHead = head - depth + 1; // newest block that is deep enough to be final

  for (const d of open.rows as DepositRow[]) {
    result.checked++;
    try {
      const asset = registry.get(d.token, chain);
      if (!asset) continue; // can't read this asset's decimals; leave the deposit untouched rather than guess
      if (d.decimals !== null && d.decimals !== asset.decimals) {
        console.error(`[settlement] deposit ${d.id}: quoted with ${d.decimals} decimals but ${asset.symbol} now reads ${asset.decimals}; skipping`);
        result.errors++;
        continue;
      }
      await settleOne(d, asset, chain, chainApi, db, { head, finalHead, window, grace, now, opts }, result);
    } catch (err) {
      result.errors++;
      console.error(`[settlement] deposit ${d.id} on ${chain} failed this pass:`, err instanceof Error ? err.message : err);
    }
  }
  return result;
}

interface Ctx { head: number; finalHead: number; window: number; grace: number; now: Date; opts: SettlementOptions }

async function settleOne(
  d: DepositRow, asset: ChainAsset, chain: string, chainApi: SettlementChain, db: Queryable, c: Ctx, result: PassResult,
): Promise<void> {
  const required = BigInt(d.amount_units);
  const expiresAtSec = Math.floor(new Date(d.expires_at).getTime() / 1000);
  const lookback = c.opts.defaultLookbackBlocks ?? 2000;

  let cursor = d.scan_cursor === null
    ? (d.from_block === null ? Math.max(0, c.head - lookback) - 1 : Number(d.from_block) - 1)
    : Number(d.scan_cursor);
  let finalUnits = BigInt(d.scan_units);
  let lateUnits = BigInt(d.late_units ?? '0');
  let crossingTx: string | null = d.tx_hash;

  // 1. Advance through final blocks, persisting as we go.
  const adv = await advanceFinal(d, asset, chainApi, db, c, required, expiresAtSec, cursor, finalUnits, lateUnits, crossingTx);
  cursor = adv.cursor; finalUnits = adv.finalUnits; lateUnits = adv.lateUnits; crossingTx = adv.crossingTx;

  // 2. Look at the not-yet-final tail without persisting it.
  let tailUnits = 0n;
  if (c.head > cursor) {
    const found = await chainApi.transfersTo(asset.address, d.address, cursor + 1, c.head);
    for (const t of found.sort((a, b) => a.blockNumber - b.blockNumber)) {
      if ((await chainApi.blockTime(t.blockNumber)) <= expiresAtSec) {
        const before = finalUnits + tailUnits;
        tailUnits += t.value;
        if (before < required && finalUnits + tailUnits >= required) crossingTx = t.txHash;
      }
    }
  }
  const seen = finalUnits + tailUnits;

  // 3. Decide.
  if (finalUnits >= required) {
    // Guarded on status so two overlapping passes credit once.
    const upd = await db.query(
      `UPDATE stablecoin_deposits
          SET status = 'confirmed', confirmed_at = now(), received_amount_units = $2, tx_hash = COALESCE($3, tx_hash),
              received_at = COALESCE(received_at, now())
        WHERE id = $1 AND status IN ('pending','confirming') RETURNING id`,
      [d.id, finalUnits.toString(), crossingTx],
    );
    if (upd.rows.length === 0) return;
    await db.query(
      `UPDATE x402_payments SET status = 'confirmed', received_units = $2, tx_hash = $3, confirmed_at = now()
        WHERE deposit_id = $1 AND status = 'pending'`,
      [d.id, finalUnits.toString(), crossingTx],
    );
    result.confirmed++;
    await emit('stablecoin.payment.confirmed', d, asset, finalUnits, crossingTx, chain, c.now);
    return;
  }

  if (seen >= required) {
    if (d.status === 'pending') {
      const upd = await db.query(
        `UPDATE stablecoin_deposits SET status = 'confirming', received_amount_units = $2, tx_hash = $3, received_at = now()
          WHERE id = $1 AND status = 'pending' RETURNING id`,
        [d.id, seen.toString(), crossingTx],
      );
      if (upd.rows.length > 0) {
        result.confirming++;
        await emit('stablecoin.payment.received', d, asset, seen, crossingTx, chain, c.now);
      }
    } else {
      await db.query(`UPDATE stablecoin_deposits SET received_amount_units = $2 WHERE id = $1`, [d.id, seen.toString()]);
    }
    return;
  }

  // Not (or no longer) enough. A 'confirming' deposit whose transfer has vanished was reorged away.
  if (d.status === 'confirming') {
    await db.query(
      `UPDATE stablecoin_deposits SET status = 'pending', received_amount_units = $2 WHERE id = $1 AND status = 'confirming'`,
      [d.id, seen === 0n ? null : seen.toString()],
    );
  } else if (seen > 0n && d.received_amount_units !== seen.toString()) {
    // A partial payment: recorded so it shows, but not a confirmation.
    await db.query(`UPDATE stablecoin_deposits SET received_amount_units = $2 WHERE id = $1 AND status = 'pending'`, [d.id, seen.toString()]);
  }

  // 4. Expiry, once the grace period has let late-confirming blocks be counted.
  if (c.now.getTime() > new Date(d.expires_at).getTime() + c.grace) {
    const upd = await db.query(
      `UPDATE stablecoin_deposits SET status = 'expired' WHERE id = $1 AND status IN ('pending','confirming') RETURNING id`, [d.id],
    );
    if (upd.rows.length > 0) {
      await db.query(`UPDATE x402_payments SET status = 'expired' WHERE deposit_id = $1 AND status = 'pending'`, [d.id]);
      result.expired++;
      if (seen > 0n || lateUnits > 0n) {
        console.warn(`[settlement] deposit ${d.id} expired with ${seen} units received (short) and ${lateUnits} units late — reconcile manually`);
      }
    }
  }
}

/**
 * Add every transfer in the final blocks after `cursor` to the deposit's running
 * totals (timely ones to `scan_units`, ones after expiry to `late_units`) and save
 * progress. Shared by normal settlement and the late scan of expired deposits.
 */
async function advanceFinal(
  d: DepositRow, asset: ChainAsset, chainApi: SettlementChain, db: Queryable, c: Ctx, required: bigint,
  expiresAtSec: number, cursor: number, finalUnits: bigint, lateUnits: bigint, crossingTx: string | null,
  statuses: string[] = ['pending', 'confirming'],
): Promise<{ cursor: number; finalUnits: bigint; lateUnits: bigint; crossingTx: string | null }> {
  while (cursor < c.finalHead) {
    const from = cursor + 1;
    const to = Math.min(c.finalHead, from + c.window - 1);
    const found = await chainApi.transfersTo(asset.address, d.address, from, to);
    for (const t of found.sort((x, y) => x.blockNumber - y.blockNumber)) {
      const timely = (await chainApi.blockTime(t.blockNumber)) <= expiresAtSec;
      if (timely) {
        const before = finalUnits;
        finalUnits += t.value;
        if (before < required && finalUnits >= required) crossingTx = t.txHash;
      } else lateUnits += t.value;
    }
    cursor = to;
    await db.query(
      `UPDATE stablecoin_deposits SET scan_cursor = $2, scan_units = $3, late_units = $4 WHERE id = $1 AND status = ANY($5)`,
      [d.id, cursor, finalUnits.toString(), lateUnits === 0n ? null : lateUnits.toString(), statuses],
    );
  }
  return { cursor, finalUnits, lateUnits, crossingTx };
}

/**
 * Keep an eye on deposits that have expired, for payments that arrive after the
 * window. They are never credited — the quote and rate have lapsed — but the money
 * is in an address this gateway controls, so it is recorded in `late_units` and
 * logged, for someone to reconcile. Runs far less often than normal settlement.
 */
export async function scanExpiredOnce(
  chain: string, chainApi: SettlementChain, db: Queryable, registry: AssetRegistry, opts: SettlementOptions,
): Promise<number> {
  const now = (opts.now ?? (() => new Date()))();
  const windowMs = opts.lateWindowMs ?? 48 * 3600_000;
  const depth = Math.max(1, opts.confirmations(chain));
  const rows = await db.query(
    `SELECT id, merchant_id, address, chain, token, amount_units, amount_usd, decimals, status, from_block,
            scan_cursor, scan_units, late_units, received_amount_units, tx_hash, expires_at
       FROM stablecoin_deposits
      WHERE chain = $1 AND status = 'expired' AND expires_at > $2
      ORDER BY expires_at DESC LIMIT 1000`,
    [chain, new Date(now.getTime() - windowMs).toISOString()],
  );
  if (rows.rows.length === 0) return 0;
  const head = await chainApi.blockNumber();
  const ctx: Ctx = { head, finalHead: head - depth + 1, window: opts.logWindow ?? 2000, grace: 0, now, opts };
  let found = 0;
  for (const d of rows.rows as DepositRow[]) {
    try {
      const asset = registry.get(d.token, chain);
      if (!asset || d.scan_cursor === null) continue;
      const before = BigInt(d.late_units ?? '0');
      const adv = await advanceFinal(d, asset, chainApi, db, ctx, BigInt(d.amount_units),
        Math.floor(new Date(d.expires_at).getTime() / 1000), Number(d.scan_cursor), BigInt(d.scan_units), before, d.tx_hash, ['expired']);
      if (adv.lateUnits > before) {
        found++;
        console.warn(`[settlement] deposit ${d.id} received ${adv.lateUnits - before} ${asset.symbol} units AFTER it expired (not credited) — reconcile manually`);
      }
    } catch (err) {
      console.error(`[settlement] late scan of deposit ${d.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return found;
}

async function emit(
  type: 'stablecoin.payment.received' | 'stablecoin.payment.confirmed',
  d: DepositRow, asset: ChainAsset, units: bigint, txHash: string | null, chain: string, now: Date,
): Promise<void> {
  try {
    await forwardToUnifiedRouter({
      eventId: randomUUID(), type, merchantId: d.merchant_id, depositId: d.id, chain,
      token: asset.symbol as 'USDC' | 'USDT' | 'ZARP' | 'OUSD', amountUnits: units.toString(), decimals: asset.decimals,
      amountUsd: Number(d.amount_usd), txHash: txHash ?? '', fromAddress: '', toAddress: d.address,
      ...(type === 'stablecoin.payment.confirmed' ? { confirmedAt: now.toISOString() } : {}),
      occurredAt: now.toISOString(),
    } as never);
  } catch (err) {
    console.error('[settlement] event forward failed (payment state is already saved):', err instanceof Error ? err.message : err);
  }
}

// ── The runner ────────────────────────────────────────────────────────────────

export interface SettlementHandle { stop(): void }

/**
 * Run settlement for each chain on an interval. Passes never overlap on a chain,
 * and a failing pass is logged and retried on the next tick.
 */
export function startSettlement(
  chains: string[], chainFor: (chain: string) => SettlementChain | null, db: Queryable, registry: AssetRegistry,
  opts: SettlementOptions, intervalMs: number,
): SettlementHandle {
  const running = new Set<string>();
  let passes = 0;
  const every = Math.max(1, opts.lateEveryPasses ?? 30);
  const tick = async () => {
    passes++;
    for (const chain of chains) {
      if (running.has(chain)) continue;
      const api = chainFor(chain);
      if (!api) continue;
      running.add(chain);
      try {
        await settleChainOnce(chain, api, db, registry, opts);
        if (passes % every === 0) await scanExpiredOnce(chain, api, db, registry, opts);
      } catch (err) {
        console.error(`[settlement] pass on ${chain} failed:`, err instanceof Error ? err.message : err);
      } finally {
        running.delete(chain);
      }
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  void tick();
  return { stop: () => clearInterval(timer) };
}

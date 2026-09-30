import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.tokens';
import { AuditService } from '../database/audit.service';
import { EthereumService } from './ethereum.service';

interface PollRow {
  request_id: string;
  customer_id: string;
  tx_hash: string;
  nonce: number | null;
  status: string;
  broadcast_at: Date | null;
  updated_at: Date;
}

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * Advances signing.transactions after broadcast:
 *   broadcasted -> confirmed   receipt found, success, >= TX_CONFIRMATIONS blocks deep (default 1)
 *   broadcasted -> failed      receipt found, status 0 (reverted on-chain)
 *   broadcasted -> stuck       no receipt TX_STUCK_AFTER_MS after broadcast (default 15 min).
 *                              Never replaced automatically; if it is mined later, it still becomes confirmed.
 * It also repairs 'broadcasting' rows orphaned by a crash (-> signed_not_broadcast), and reconciles
 * signed_not_broadcast rows against the chain: a broadcast that "failed" ambiguously (e.g. an RPC
 * timeout) may have been accepted, and a receipt for the row's hash is the truth.
 *
 * All state lives in the database, so restarting the gateway loses nothing. Every write is
 * conditional on the row still being in the state that was read, so a repeated or concurrent
 * cycle is harmless, and a Postgres advisory lock lets several gateways run without duplicating work.
 */
@Injectable()
export class TxPollerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TxPollerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private rpcWasDown = false;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly ethereum: EthereumService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    if (!this.ethereum.canBroadcast) return;
    const every = num('TX_POLL_INTERVAL_MS', 5000);
    this.timer = setInterval(() => void this.pollOnce(), every);
    this.timer.unref?.();
    void this.pollOnce();
    this.logger.log(`transaction poller started (every ${every}ms, ${num('TX_CONFIRMATIONS', 1)} confirmation(s) required)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over every unsettled transaction. Safe to call at any time, from any number of callers. */
  async pollOnce(): Promise<{ checked: number; changed: number }> {
    if (this.running || !this.ethereum.canBroadcast) return { checked: 0, changed: 0 };
    this.running = true;
    const client = await this.pool.connect();
    try {
      const got = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(hashtext('tx-poller')) AS locked`);
      if (!got.rows[0].locked) return { checked: 0, changed: 0 }; // another gateway is polling
      try {
        return await this.cycle();
      } finally {
        await client.query(`SELECT pg_advisory_unlock(hashtext('tx-poller'))`).catch(() => undefined);
      }
    } catch (err) {
      this.logger.error(`poll cycle failed: ${(err as Error).message}`);
      return { checked: 0, changed: 0 };
    } finally {
      client.release();
      this.running = false;
    }
  }

  private async cycle(): Promise<{ checked: number; changed: number }> {
    let changed = await this.repairOrphans();

    let chainId: number;
    let head: number;
    try {
      chainId = await this.ethereum.getChainId();
      head = await this.ethereum.getBlockNumber();
      if (this.rpcWasDown) this.logger.log('network RPC reachable again');
      this.rpcWasDown = false;
    } catch (err) {
      if (!this.rpcWasDown) this.logger.warn(`network RPC unreachable; transaction tracking paused (${(err as Error).message})`);
      this.rpcWasDown = true;
      return { checked: 0, changed };
    }

    // Only this network's rows: after pointing the gateway at another chain, old rows are left alone.
    const { rows } = await this.pool.query<PollRow>(
      `SELECT request_id, customer_id, tx_hash, nonce, status, broadcast_at, updated_at
         FROM signing.transactions
        WHERE status IN ('broadcasted', 'stuck', 'signed_not_broadcast') AND chain_id = $1 AND tx_hash IS NOT NULL AND signed_tx <> ''
        ORDER BY id LIMIT 500`,
      [chainId],
    );
    for (const row of rows) {
      try {
        if (await this.settle(row, head)) changed++;
      } catch (err) {
        this.logger.warn(`could not check ${row.tx_hash}: ${(err as Error).message}`);
      }
    }
    return { checked: rows.length, changed };
  }

  /** A crash between "claim the row" and "record the outcome" leaves 'broadcasting' behind. */
  private async repairOrphans(): Promise<number> {
    const res = await this.pool.query<{ request_id: string; customer_id: string }>(
      `UPDATE signing.transactions
          SET status = 'signed_not_broadcast', updated_at = NOW(),
              status_detail = 'the gateway stopped before this transaction was broadcast; it was signed and is safe to rebroadcast'
        WHERE status = 'broadcasting' AND updated_at < NOW() - INTERVAL '60 seconds'
        RETURNING request_id, customer_id`,
    );
    for (const r of res.rows) {
      this.logger.warn(`recovered orphaned broadcast ${r.request_id} -> signed_not_broadcast`);
      await this.audit.logEvent({
        type: 'BROADCAST_INTERRUPTED', requestId: r.request_id, customerId: r.customer_id,
        message: 'gateway stopped mid-broadcast', status: 'signed_not_broadcast',
      });
    }
    return res.rowCount ?? 0;
  }

  /** Decide one row. Returns true when it changed. */
  private async settle(row: PollRow, head: number): Promise<boolean> {
    const required = num('TX_CONFIRMATIONS', 1);
    const receipt = await this.ethereum.getTransactionReceipt(row.tx_hash);

    if (receipt) {
      const confirmations = Math.max(0, head - receipt.blockNumber + 1);
      const summary = {
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        status: receipt.status,
        from: receipt.from,
        to: receipt.to,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.gasPrice?.toString(),
      };
      if (receipt.status === 0) {
        return this.transition(row, 'failed', `reverted on-chain in block ${receipt.blockNumber}`, receipt.blockNumber, confirmations, summary);
      }
      if (confirmations >= required) {
        return this.transition(row, 'confirmed', null, receipt.blockNumber, confirmations, summary);
      }
      // Mined but not deep enough yet: keep the count fresh, stay 'broadcasted'.
      const r = await this.pool.query(
        `UPDATE signing.transactions SET block_number = $2, confirmation_count = $3, updated_at = NOW()
          WHERE request_id = $1 AND status IN ('broadcasted','stuck','signed_not_broadcast') AND confirmation_count IS DISTINCT FROM $3`,
        [row.request_id, receipt.blockNumber, confirmations],
      );
      // Found on the network after all (was stuck, or a "failed" broadcast that had actually gone through).
      const revived = row.status === 'stuck' || row.status === 'signed_not_broadcast'
        ? await this.pool.query(
            `UPDATE signing.transactions SET status = 'broadcasted', status_detail = NULL, broadcast_at = COALESCE(broadcast_at, NOW())
              WHERE request_id = $1 AND status IN ('stuck', 'signed_not_broadcast')`,
            [row.request_id],
          )
        : null;
      return (r.rowCount ?? 0) > 0 || (revived?.rowCount ?? 0) > 0;
    }

    // No receipt. A signed_not_broadcast row may simply be waiting for someone to click Rebroadcast.
    // For the others, give it time, then say so honestly.
    if (row.status === 'stuck' || row.status === 'signed_not_broadcast') return false;
    const since = new Date(row.broadcast_at ?? row.updated_at).getTime();
    const limit = num('TX_STUCK_AFTER_MS', 15 * 60 * 1000);
    if (Date.now() - since < limit) return false;
    const known = await this.ethereum.getTransaction(row.tx_hash).catch(() => null);
    const minutes = Math.round((Date.now() - since) / 60000);
    const why = known
      ? 'the network still holds it as pending (its fee may be too low, or an earlier nonce is missing)'
      : 'the network no longer has it (it may have been dropped from the mempool)';
    return this.transition(
      row,
      'stuck',
      `no receipt ${minutes} min after broadcast: ${why}. It is not replaced automatically.`,
      null,
      0,
      null,
    );
  }

  private async transition(
    row: PollRow,
    status: 'confirmed' | 'failed' | 'stuck',
    detail: string | null,
    blockNumber: number | null,
    confirmations: number,
    receipt: object | null,
  ): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE signing.transactions
          SET status = $2, status_detail = $3, block_number = COALESCE($4, block_number),
              confirmation_count = $5, receipt = COALESCE($6::json, receipt), updated_at = NOW()
        WHERE request_id = $1 AND status IN ('broadcasted', 'stuck', 'signed_not_broadcast')`,
      [row.request_id, status, detail, blockNumber, confirmations, receipt ? JSON.stringify(receipt) : null],
    );
    if ((res.rowCount ?? 0) === 0) return false; // someone else settled it first
    this.logger.log(`${row.tx_hash} -> ${status}${blockNumber ? ` (block ${blockNumber}, ${confirmations} conf)` : ''}`);
    await this.audit.logEvent({
      type: status === 'confirmed' ? 'TX_CONFIRMED' : status === 'failed' ? 'TX_FAILED' : 'TX_STUCK',
      requestId: row.request_id,
      customerId: row.customer_id,
      hash: row.tx_hash,
      message: detail ?? `confirmed in block ${blockNumber}`,
      status,
    });
    return true;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.tokens';

/**
 * Nonce ownership, per signing address.
 *
 * DESIGN (why nonces can't be allocated at request time)
 * ------------------------------------------------------
 * A nonce is a promise: "this address will send exactly one transaction with
 * this number, and every later transaction waits behind it". If a number is
 * handed out and the transaction never gets signed (approval rejected, signer
 * nodes down, request abandoned) the address has a permanent hole and
 * everything after it is stuck. So:
 *
 *  1. Nothing reserves a nonce while a transfer is only *requested* or waiting
 *     for approval. Approval can take days and can end in rejection.
 *  2. The nonce is chosen at the last possible moment, inside a per-address
 *     lock (in-process queue + a Postgres advisory lock, so several gateway
 *     instances also agree), immediately before the MPC signer is asked to
 *     sign, and the lock is not released until the signed row is persisted
 *     with that nonce. Two concurrent transfers therefore run one after the
 *     other and can never see the same "next" nonce.
 *  3. If signing fails, nothing was persisted, so the number was never
 *     consumed: the next transfer simply takes it. A rejected transfer never
 *     reached step 2 at all. Either way there is no gap.
 *  4. Once a row is signed it *does* own its nonce until it is mined or
 *     provably dead: signed_not_broadcast rows keep it, and Rebroadcast sends
 *     the same bytes. A row that ends 'failed' without a receipt (e.g. the
 *     chain says "nonce too low" and no receipt exists) gives its number back.
 *
 * next = max(what the node says is pending, 1 + highest nonce we hold for
 * transactions that are signed but not yet mined). When the RPC can't be
 * reached we fall back to our own records of every transaction this key has
 * signed on this chain: a workspace key is used only through this gateway, so
 * our records are authoritative for it.
 */

/** Statuses whose nonce is spoken for but not yet mined (the chain can't tell us about these). */
export const IN_FLIGHT_STATUSES = ['broadcasting', 'signed_not_broadcast', 'broadcasted', 'stuck'];
/** Every status that consumed (or, for signed-only, would consume) a nonce. */
const CONSUMING_STATUSES = ['signed', ...IN_FLIGHT_STATUSES, 'confirmed'];

@Injectable()
export class NonceService {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Run `fn` while holding the exclusive right to allocate nonces for `address`.
   * Waiters queue in-process first so only one pool connection per address is
   * ever parked on the advisory lock.
   */
  async withAddressLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
    const key = address.toLowerCase();
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = previous.then(() => mine);
    this.queues.set(key, tail);
    await previous.catch(() => undefined);
    let client;
    try {
      client = await this.pool.connect();
      await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [`nonce:${key}`]);
      return await fn();
    } finally {
      if (client) {
        await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`nonce:${key}`]).catch(() => undefined);
        client.release();
      }
      release();
      if (this.queues.get(key) === tail) this.queues.delete(key);
    }
  }

  /** The next nonce for `address` on `chainId`. Call only while holding withAddressLock. */
  async next(address: string, chainId: number, rpcPending: number | null): Promise<number> {
    // Reachable RPC: the chain already counts everything mined or pending in its mempool, so
    // only our own signed-but-unmined rows can be ahead of it. Unreachable: use all our records.
    const statuses = rpcPending === null ? CONSUMING_STATUSES : IN_FLIGHT_STATUSES;
    const { rows } = await this.pool.query<{ next: string | null }>(
      `SELECT MAX(nonce) + 1 AS next FROM signing.transactions
        WHERE lower(from_address) = lower($1) AND chain_id = $2
          AND (status = ANY($3) OR (status = 'failed' AND receipt IS NOT NULL AND $4::boolean))`,
      [address, chainId, statuses, rpcPending === null],
    );
    const ours = rows[0].next === null ? 0 : Number(rows[0].next);
    return Math.max(rpcPending ?? 0, ours);
  }

  /**
   * Wei already spoken for by signed-but-unmined transfers from this address
   * (value + max fee), excluding any the chain has already mined (nonce below
   * the node's latest count), so it isn't subtracted twice from the balance.
   */
  async committedWei(address: string, chainId: number, latestNonce: number): Promise<bigint> {
    const { rows } = await this.pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(COALESCE(NULLIF(amount, '')::numeric, 0)
                         + COALESCE(NULLIF(gas_limit, '')::numeric, 0) * COALESCE(NULLIF(gas_price, '')::numeric, 0)), 0)::text AS total
         FROM signing.transactions
        WHERE lower(from_address) = lower($1) AND chain_id = $2
          AND status = ANY($3) AND nonce >= $4`,
      [address, chainId, IN_FLIGHT_STATUSES, latestNonce],
    );
    return BigInt(rows[0].total.split('.')[0]);
  }
}

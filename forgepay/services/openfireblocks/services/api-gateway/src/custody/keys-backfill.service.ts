import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.tokens';
import { KeysService } from './keys.service';

export interface BackfillResult {
  created: number;
  already: number;
  failed: Array<{ customerId: string; reason: string }>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Workspaces that existed before threshold signing only get a key lazily, on
 * their first transfer. This provisions one for every workspace that has
 * custody signers or signing history and no active key.
 *
 * - Strictly serialized: one key generation at a time, in this process (a promise
 *   chain) and across processes (KeysService.ensureKey's per-workspace advisory lock).
 * - Resumable and idempotent: there is no progress file. "Needs a key" is read from
 *   the database each time, so a crash or restart just carries on with what's left.
 * - Never crashes the gateway: signer/node outages are caught per workspace; the
 *   background run retries the failures with exponential backoff.
 * - Nothing is deleted or rewritten. Workspaces with shared-key history keep it;
 *   the new key row records the legacy address (KeysService.ensureKey).
 */
@Injectable()
export class KeysBackfillService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(KeysBackfillService.name);
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly keys: KeysService,
  ) {}

  onApplicationBootstrap() {
    if (!this.keys.thresholdEnabled || process.env.KEY_BACKFILL_ON_START === 'false') return;
    void this.backgroundLoop().catch((err) => this.logger.error(`backfill loop crashed: ${err?.message ?? err}`));
  }

  onModuleDestroy() {
    this.stopped = true;
  }

  /** Every active customer with signers or signing transactions, keyed or not. */
  async candidates(): Promise<string[]> {
    const { rows } = await this.pool.query<{ customer_id: string }>(
      `SELECT c.customer_id FROM customers c
        WHERE c.status = 'active'
          AND (EXISTS (SELECT 1 FROM custody.signers s WHERE s.customer_id = c.customer_id)
            OR EXISTS (SELECT 1 FROM signing.transactions t WHERE t.customer_id = c.customer_id))
        ORDER BY c.customer_id`,
    );
    return rows.map((r) => r.customer_id);
  }

  /** One serialized pass. Concurrent callers queue behind each other. */
  run(): Promise<BackfillResult> {
    const next = this.queue.then(() => this.pass());
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async pass(): Promise<BackfillResult> {
    const result: BackfillResult = { created: 0, already: 0, failed: [] };
    if (!this.keys.thresholdEnabled) {
      // Nothing to provision; say so for every candidate rather than silently succeeding.
      for (const customerId of await this.candidates()) {
        result.failed.push({ customerId, reason: 'threshold signing is not enabled (MPC_THRESHOLD_SIGNING)' });
      }
      return result;
    }
    for (const customerId of await this.candidates()) {
      try {
        if (await this.keys.activeKey(customerId)) {
          result.already++;
          continue;
        }
        this.logger.log(`backfill: creating key for ${customerId}`);
        const key = await this.keys.ensureKey(customerId);
        result.created++;
        this.logger.log(`backfill: ${customerId} -> ${key.address}`);
      } catch (err: any) {
        const body = err?.getResponse?.();
        const reason = String(body?.detail ?? err?.message ?? err);
        this.logger.warn(`backfill: ${customerId} failed: ${reason}`);
        result.failed.push({ customerId, reason });
      }
    }
    return result;
  }

  /** Retry failures with exponential backoff (5s doubling to 5min) until done or out of attempts. */
  private async backgroundLoop() {
    const maxAttempts = Number(process.env.KEY_BACKFILL_MAX_ATTEMPTS ?? 30);
    let delay = Number(process.env.KEY_BACKFILL_FIRST_DELAY_MS ?? 5000);
    for (let attempt = 1; attempt <= maxAttempts && !this.stopped; attempt++) {
      const status = await this.keys.status();
      if (status?.canSign) {
        const r = await this.run();
        this.logger.log(`backfill pass ${attempt}: created ${r.created}, already ${r.already}, failed ${r.failed.length}`);
        if (r.failed.length === 0) return;
      } else {
        this.logger.warn(`backfill pass ${attempt}: signer/nodes not ready; retrying in ${Math.round(delay / 1000)}s`);
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 5 * 60 * 1000);
    }
    if (!this.stopped) this.logger.error('backfill gave up after repeated failures; POST /admin/custody/keys/backfill retries it');
  }
}

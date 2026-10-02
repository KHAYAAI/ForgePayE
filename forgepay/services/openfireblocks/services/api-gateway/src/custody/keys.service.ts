import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { installSignerAuth } from '../common/signer-auth';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.tokens';

export interface KeyRow {
  key_id: string;
  customer_id: string;
  address: string;
  public_key: string;
  scheme: string;
  threshold: number;
  nodes: string[];
  status: string;
  created_at: Date;
  /** Reshares so far; 0 = as first generated. */
  epoch: number;
  rotated_at: Date | null;
  /** Set when this workspace had already signed with the old shared signer key: that key's address. */
  legacy_signer_address: string | null;
}

export interface MpcStatus {
  enabled: boolean;
  threshold?: number;
  signersNeeded?: number;
  total?: number;
  reachable?: number;
  canSign?: boolean;
  trustDomains?: number;
  thresholdOnly?: boolean;
  nodes?: Array<{
    id: string;
    domain: string;
    reachable: boolean;
    seal_provider?: string;
    mtls?: boolean;
    policy?: { digest: string; active: string[] } | null;
    backup?: { enabled: boolean; stale?: boolean; coversCurrentShares?: boolean; lastError?: string; lastOk?: string } | null;
  }>;
  /** Trust domains that hold enough nodes to sign alone. Empty is sound. */
  exposedDomains?: string[];
  production?: boolean;
}

/** What the signing nodes collectively say about one key right now. */
export interface KeyMeta {
  keyId: string;
  address: string;
  epoch: number;
  threshold: number;
  participants: string[];
  holders: string[];
  stale?: string[];
  pending?: Record<string, number>;
}

export interface RotationResult {
  keyId: string;
  address: string;
  fromEpoch: number;
  toEpoch: number;
  oldNodes: string[];
  newNodes: string[];
  threshold: number;
  retired: string[] | null;
  notRetired?: string[];
}

export interface FleetRotationJob {
  state: 'running' | 'done';
  startedAt: string;
  finishedAt?: string;
  nodes: string[];
  signersNeeded: number;
  total: number;
  rotated: number;
  skipped: number;
  failed: Array<{ customerId: string; reason: string }>;
  current?: string;
}

/**
 * Per-workspace signing keys. With MPC_THRESHOLD_SIGNING=true every workspace
 * gets its own threshold key, generated across the signing nodes the first
 * time it needs one; otherwise everything signs with the signer's single
 * shared key, as before.
 */
@Injectable()
export class KeysService {
  private readonly logger = new Logger(KeysService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly http: HttpService,
  ) {
    installSignerAuth(this.http);
  }

  get thresholdEnabled(): boolean {
    return process.env.MPC_THRESHOLD_SIGNING === 'true';
  }

  private get signerUrl(): string {
    return process.env.MPC_SIGNER_URL ?? 'http://localhost:8080';
  }

  async activeKey(customerId: string): Promise<KeyRow | null> {
    const { rows } = await this.pool.query<KeyRow>(
      `SELECT * FROM custody.keys WHERE customer_id = $1 AND status = 'active'`,
      [customerId],
    );
    return rows[0] ?? null;
  }

  /**
   * If this workspace signed anything before it had a key of its own, those
   * transactions came from the old shared signer key. Recover that address from
   * the signed bytes themselves (ground truth), falling back to asking the signer.
   * Returns null when the workspace has no such history.
   */
  private async legacyAddressFor(customerId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ signed_tx: string }>(
      `SELECT signed_tx FROM signing.transactions
        WHERE customer_id = $1 AND signed_tx IS NOT NULL AND signed_tx <> '' ORDER BY id LIMIT 1`,
      [customerId],
    );
    if (!rows[0]) return null;
    try {
      const from = ethers.Transaction.from(rows[0].signed_tx).from;
      if (from) return from;
    } catch {
      /* fall through */
    }
    try {
      const res = await lastValueFrom(this.http.get<{ address: string }>(`${this.signerUrl}/address`, { timeout: 5000 }));
      return res.data.address ?? null;
    } catch {
      return null;
    }
  }

  /**
   * The workspace's key, generating it if it has none. Concurrent callers for
   * the same workspace wait on one lock, so two simultaneous first transfers
   * produce one key, not two.
   */
  async ensureKey(customerId: string): Promise<KeyRow> {
    const existing = await this.activeKey(customerId);
    if (existing) return existing;

    const client = await this.pool.connect();
    try {
      await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [`custody-key:${customerId}`]);
      const again = await this.activeKey(customerId);
      if (again) return again;

      // Only a workspace that has never had any key can have shared-key history.
      const everKeyed = await client.query(`SELECT 1 FROM custody.keys WHERE customer_id = $1 LIMIT 1`, [customerId]);
      const legacy = everKeyed.rows.length === 0 ? await this.legacyAddressFor(customerId) : null;

      const keyId = `key-${randomUUID()}`;
      let info: { keyId: string; address: string; publicKey: string; threshold: number; nodes: string[] };
      try {
        const res = await lastValueFrom(
          this.http.post(`${this.signerUrl}/mpc/keys`, { keyId }, { timeout: 5 * 60 * 1000 }),
        );
        info = res.data;
      } catch (err: any) {
        const detail = err?.response?.data?.error ?? err?.message ?? 'unknown error';
        this.logger.error(`key generation for ${customerId} failed: ${detail}`);
        throw new ServiceUnavailableException({
          error: 'Key generation failed',
          detail: `Could not create this workspace's signing key: ${detail}`,
        });
      }
      const { rows } = await client.query<KeyRow>(
        `INSERT INTO custody.keys (key_id, customer_id, address, public_key, scheme, threshold, nodes, legacy_signer_address)
         VALUES ($1, $2, $3, $4, 'threshold-ecdsa', $5, $6, $7) RETURNING *`,
        [info.keyId, customerId, info.address, info.publicKey, info.threshold, info.nodes, legacy],
      );
      this.logger.log(
        `created ${info.threshold + 1}-of-${info.nodes.length} key ${info.address} for ${customerId}` +
          (legacy ? ` (earlier transactions were signed by the shared key ${legacy})` : ''),
      );
      return rows[0];
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`custody-key:${customerId}`]).catch(() => undefined);
      client.release();
    }
  }

  async keyMeta(keyId: string): Promise<KeyMeta | null> {
    try {
      const res = await lastValueFrom(this.http.get<KeyMeta>(`${this.signerUrl}/mpc/keys/${encodeURIComponent(keyId)}`, { timeout: 7000 }));
      return res.data;
    } catch {
      return null;
    }
  }

  /** Check a proposed committee against what the signer knows, before anyone votes on it. */
  async validateRotation(nodes: unknown, signersNeeded: unknown): Promise<{ nodes: string[]; threshold: number }> {
    if (!Array.isArray(nodes) || nodes.some((n) => typeof n !== 'string')) {
      throw new BadRequestException('payload.nodes must be a list of node ids');
    }
    const ids = nodes as string[];
    if (new Set(ids).size !== ids.length) throw new BadRequestException('payload.nodes lists a node twice');
    if (!Number.isInteger(signersNeeded) || (signersNeeded as number) < 2 || (signersNeeded as number) > ids.length) {
      throw new BadRequestException('payload.signers_needed must be a whole number from 2 up to the number of nodes');
    }
    const mpc = await this.status();
    if (!mpc?.enabled) throw new ServiceUnavailableException('the signer is not reachable, so a rotation cannot be checked');
    const known = new Set((mpc.nodes ?? []).map((n) => n.id));
    const unknown = ids.filter((n) => !known.has(n));
    if (unknown.length) throw new BadRequestException(`unknown signing node(s): ${unknown.join(', ')}`);
    return { nodes: ids, threshold: (signersNeeded as number) - 1 };
  }

  /**
   * Move a workspace's key to a new committee and/or threshold, keeping its
   * address. Runs under the same lock as key creation, so a rotation can't
   * interleave with the key being generated or with another rotation.
   */
  async rotate(customerId: string, nodes: string[], threshold: number): Promise<RotationResult> {
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [`custody-key:${customerId}`]);
      const key = await this.activeKey(customerId);
      if (!key) throw new NotFoundException('this workspace has no signing key to rotate');
      let data: { result: RotationResult; steps: string[] };
      try {
        const res = await lastValueFrom(
          this.http.post(`${this.signerUrl}/mpc/keys/${encodeURIComponent(key.key_id)}/reshare`, { nodes, threshold }, { timeout: 12 * 60 * 1000 }),
        );
        data = res.data;
      } catch (err: any) {
        const detail = err?.response?.data?.error ?? err?.message ?? 'unknown error';
        this.logger.error(`rotation of ${key.address} for ${customerId} failed: ${detail}`);
        throw new ServiceUnavailableException({ error: 'Key rotation failed', detail: `The key was not changed: ${detail}` });
      }
      const r = data.result;
      await client.query(
        `UPDATE custody.keys SET nodes = $2, threshold = $3, epoch = $4, rotated_at = NOW() WHERE key_id = $1`,
        [key.key_id, r.newNodes, r.threshold, r.toEpoch],
      );
      this.logger.log(`rotated ${r.address} for ${customerId}: epoch ${r.fromEpoch}->${r.toEpoch}, now ${r.threshold + 1}-of-${r.newNodes.length}`);
      return r;
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`custody-key:${customerId}`]).catch(() => undefined);
      client.release();
    }
  }

  /** Destroy leftover old shares on nodes that were offline when a reshare finished. */
  async retireStale(customerId: string): Promise<{ retired: string[]; notRetired: string[] }> {
    const key = await this.activeKey(customerId);
    if (!key) throw new NotFoundException('this workspace has no signing key');
    try {
      const res = await lastValueFrom(
        this.http.post(`${this.signerUrl}/mpc/keys/${encodeURIComponent(key.key_id)}/retire-stale`, {}, { timeout: 60000 }),
      );
      return { retired: res.data.retired ?? [], notRetired: res.data.notRetired ?? [] };
    } catch (err: any) {
      throw new ServiceUnavailableException(err?.response?.data?.error ?? err?.message ?? 'signer unreachable');
    }
  }

  private fleet: FleetRotationJob | null = null;

  fleetStatus(): FleetRotationJob | null {
    return this.fleet;
  }

  /**
   * Operator action: move every workspace's key to the same committee (for
   * example after a node is replaced). Runs in the background, one workspace at
   * a time, because each rotation needs the new nodes' spare pre-parameters.
   */
  startFleetRotation(nodes: string[], threshold: number): FleetRotationJob {
    if (this.fleet?.state === 'running') throw new BadRequestException('a fleet rotation is already running');
    const job: FleetRotationJob = {
      state: 'running', startedAt: new Date().toISOString(), nodes, signersNeeded: threshold + 1,
      total: 0, rotated: 0, skipped: 0, failed: [],
    };
    this.fleet = job;
    void this.runFleet(job, nodes, threshold);
    return job;
  }

  private async runFleet(job: FleetRotationJob, nodes: string[], threshold: number) {
    try {
      const { rows } = await this.pool.query<KeyRow>(`SELECT * FROM custody.keys WHERE status = 'active' ORDER BY created_at`);
      job.total = rows.length;
      for (const key of rows) {
        job.current = key.customer_id;
        const same = key.threshold === threshold && key.nodes.length === nodes.length && nodes.every((n) => key.nodes.includes(n));
        if (same && !process.env.FLEET_REFRESH_SAME) { job.skipped++; continue; }
        // A node that isn't ready yet (still making pre-parameters) is retried, not failed.
        let lastErr = '';
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            await this.rotate(key.customer_id, nodes, threshold);
            job.rotated++;
            lastErr = '';
            break;
          } catch (err: any) {
            lastErr = err?.response?.detail ?? err?.message ?? String(err);
            if (!/pre-?param|still generating|try again/i.test(lastErr)) break;
            await new Promise((r) => setTimeout(r, 30_000));
          }
        }
        if (lastErr) job.failed.push({ customerId: key.customer_id, reason: lastErr });
      }
    } catch (err: any) {
      job.failed.push({ customerId: '*', reason: err?.message ?? String(err) });
    } finally {
      job.state = 'done';
      job.finishedAt = new Date().toISOString();
      job.current = undefined;
    }
  }

  async status(): Promise<MpcStatus | null> {
    try {
      const res = await lastValueFrom(this.http.get<MpcStatus>(`${this.signerUrl}/mpc/status`, { timeout: 5000 }));
      return res.data;
    } catch {
      return null;
    }
  }
}

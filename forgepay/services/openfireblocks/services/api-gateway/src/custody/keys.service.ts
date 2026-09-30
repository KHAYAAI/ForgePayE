import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
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
  nodes?: Array<{ id: string; domain: string; reachable: boolean }>;
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
  ) {}

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
        `INSERT INTO custody.keys (key_id, customer_id, address, public_key, scheme, threshold, nodes)
         VALUES ($1, $2, $3, $4, 'threshold-ecdsa', $5, $6) RETURNING *`,
        [info.keyId, customerId, info.address, info.publicKey, info.threshold, info.nodes],
      );
      this.logger.log(`created ${info.threshold + 1}-of-${info.nodes.length} key ${info.address} for ${customerId}`);
      return rows[0];
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`custody-key:${customerId}`]).catch(() => undefined);
      client.release();
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

import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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

  async status(): Promise<MpcStatus | null> {
    try {
      const res = await lastValueFrom(this.http.get<MpcStatus>(`${this.signerUrl}/mpc/status`, { timeout: 5000 }));
      return res.data;
    } catch {
      return null;
    }
  }
}

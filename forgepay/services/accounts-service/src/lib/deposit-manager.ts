import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { CircleClient } from './circle-client.js';
import type { WalletManager } from './wallet-manager.js';
import { config } from '../config.js';

export interface DepositRequest {
  accountId:  string;
  merchantId: string;
  amountUsd:  number;
  chain?:     string;
}

export interface DepositRecord {
  id:              string;
  accountId:       string;
  merchantId:      string;
  amountUsd:       number;
  amountUnits:     string;
  chain:           string;
  depositAddress:  string;
  circleIntentId?: string;
  status:          'pending' | 'processing' | 'confirmed' | 'failed';
  txHash?:         string;
  createdAt:       string;
  confirmedAt?:    string;
  expiresAt:       string;
}

function toRecord(row: Record<string, unknown>): DepositRecord {
  return {
    id:              row['id'] as string,
    accountId:       row['account_id'] as string,
    merchantId:      row['merchant_id'] as string,
    amountUsd:       parseFloat(row['amount_usd'] as string),
    amountUnits:     row['amount_units'] as string,
    chain:           row['chain'] as string,
    depositAddress:  row['deposit_address'] as string,
    circleIntentId:  row['circle_intent_id'] as string | undefined,
    status:          row['status'] as DepositRecord['status'],
    txHash:          row['tx_hash'] as string | undefined,
    createdAt:       (row['created_at'] as Date).toISOString(),
    confirmedAt:     row['confirmed_at'] ? (row['confirmed_at'] as Date).toISOString() : undefined,
    expiresAt:       (row['expires_at'] as Date).toISOString(),
  };
}

export class DepositManager {
  constructor(
    private readonly db: Pool,
    private readonly circle: CircleClient,
    private readonly wallets: WalletManager,
  ) {}

  async createDeposit(req: DepositRequest): Promise<DepositRecord> {
    const chain       = req.chain ?? config.accounts.defaultChain;
    const amountUnits = Math.round(req.amountUsd * 1_000_000).toString();
    const depositId   = randomUUID();
    const expiresAt   = new Date(Date.now() + config.accounts.depositTtlSeconds * 1000).toISOString();

    // Generate a Circle payment intent (USD deposit address)
    let depositAddress = '';
    let circleIntentId: string | undefined;

    try {
      const intent = await this.circle.createPaymentIntent({
        idempotencyKey: `dep-${depositId}`,
        amountUsd:      req.amountUsd.toFixed(2),
        chain,
      });
      depositAddress = intent.depositAddress.address;
      circleIntentId = intent.id;
    } catch (err) {
      console.warn('[deposit-manager] Circle intent failed, falling back to direct wallet:', err);
      // Fall back to a direct on-chain address if Circle is unavailable
      const wallet   = await this.wallets.generateWallet(chain);
      depositAddress = wallet.address;

      // Store the wallet for later sweeping
      await this.db.query(
        `UPDATE fp_accounts SET wallet_address = $1, encrypted_key = $2 WHERE id = $3 AND wallet_address IS NULL`,
        [wallet.address, wallet.encryptedKey, req.accountId],
      );
    }

    await this.db.query(
      `INSERT INTO fp_deposits
         (id, account_id, merchant_id, amount_usd, amount_units, chain, deposit_address,
          circle_intent_id, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
      [
        depositId, req.accountId, req.merchantId,
        req.amountUsd, amountUnits, chain, depositAddress,
        circleIntentId ?? null, expiresAt,
      ],
    );

    const result = await this.db.query(
      `SELECT * FROM fp_deposits WHERE id = $1`, [depositId],
    );
    return toRecord(result.rows[0] as Record<string, unknown>);
  }

  async checkDepositStatus(depositId: string): Promise<DepositRecord> {
    const result = await this.db.query(
      `SELECT * FROM fp_deposits WHERE id = $1`, [depositId],
    );
    if (result.rows.length === 0) throw new Error(`Deposit ${depositId} not found`);
    const deposit = toRecord(result.rows[0] as Record<string, unknown>);

    if (deposit.status !== 'pending' && deposit.status !== 'processing') {
      return deposit; // Already settled
    }

    if (!deposit.circleIntentId) return deposit;

    try {
      const intent = await this.circle.getPaymentIntent(deposit.circleIntentId);
      if (intent.status === 'complete') {
        await this.db.query(
          `UPDATE fp_deposits SET status = 'confirmed', confirmed_at = now()
           WHERE id = $1 AND status != 'confirmed'`,
          [depositId],
        );
        await this.db.query(
          `UPDATE fp_accounts
           SET balance_usdc = balance_usdc + $1::numeric / 1000000,
               updated_at   = now()
           WHERE id = $2`,
          [deposit.amountUnits, deposit.accountId],
        );
        return { ...deposit, status: 'confirmed', confirmedAt: new Date().toISOString() };
      }
    } catch (err) {
      console.error('[deposit-manager] Failed to check Circle intent status:', err);
    }

    return deposit;
  }

  async confirmDirectDeposit(depositId: string, txHash: string): Promise<DepositRecord> {
    const result = await this.db.query(`SELECT * FROM fp_deposits WHERE id = $1`, [depositId]);
    if (result.rows.length === 0) throw new Error(`Deposit ${depositId} not found`);
    const deposit = toRecord(result.rows[0] as Record<string, unknown>);

    await this.db.query(
      `UPDATE fp_deposits SET status = 'confirmed', tx_hash = $1, confirmed_at = now() WHERE id = $2`,
      [txHash, depositId],
    );
    await this.db.query(
      `UPDATE fp_accounts
       SET balance_usdc = balance_usdc + $1::numeric / 1000000, updated_at = now()
       WHERE id = $2`,
      [deposit.amountUnits, deposit.accountId],
    );

    return { ...deposit, status: 'confirmed', txHash, confirmedAt: new Date().toISOString() };
  }
}

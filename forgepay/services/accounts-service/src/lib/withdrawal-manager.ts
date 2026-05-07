import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { encryptPrivateKey, decryptPrivateKey } from './keystore.js';
import type { CircleClient, WireDetails } from './circle-client.js';
import { config } from '../config.js';

export interface WithdrawalRequest {
  accountId:  string;
  merchantId: string;
  amountUsd:  number;
  wireDetails: WireDetails;
}

export interface WithdrawalRecord {
  id:               string;
  accountId:        string;
  merchantId:       string;
  amountUsd:        number;
  feeUsd:           number;
  netAmountUsd:     number;
  status:           'pending' | 'processing' | 'completed' | 'failed';
  circlePayoutId?:  string;
  createdAt:        string;
  completedAt?:     string;
}

function toRecord(row: Record<string, unknown>): WithdrawalRecord {
  const amountUsd    = parseFloat(row['amount_usd'] as string);
  const feeUsd       = parseFloat(row['fee_usd'] as string);
  return {
    id:              row['id'] as string,
    accountId:       row['account_id'] as string,
    merchantId:      row['merchant_id'] as string,
    amountUsd,
    feeUsd,
    netAmountUsd:    parseFloat(row['net_amount_usd'] as string),
    status:          row['status'] as WithdrawalRecord['status'],
    circlePayoutId:  row['circle_payout_id'] as string | undefined,
    createdAt:       (row['created_at'] as Date).toISOString(),
    completedAt:     row['completed_at'] ? (row['completed_at'] as Date).toISOString() : undefined,
  };
}

export class WithdrawalManager {
  constructor(
    private readonly db: Pool,
    private readonly circle: CircleClient,
  ) {}

  async initiateWithdrawal(req: WithdrawalRequest): Promise<WithdrawalRecord> {
    const feeUsd      = parseFloat((req.amountUsd * (config.accounts.withdrawalFeePercent / 100)).toFixed(2));
    const netAmount   = parseFloat((req.amountUsd - feeUsd).toFixed(2));

    // Validate balance
    const balResult = await this.db.query(
      `SELECT balance_usdc FROM fp_accounts WHERE id = $1 FOR UPDATE`, [req.accountId],
    );
    if (balResult.rows.length === 0) throw new Error(`Account ${req.accountId} not found`);
    const balance = parseFloat((balResult.rows[0] as Record<string, unknown>)['balance_usdc'] as string);
    if (balance < req.amountUsd) {
      throw new Error(`Insufficient balance: have $${balance.toFixed(2)}, need $${req.amountUsd.toFixed(2)}`);
    }

    const withdrawalId = randomUUID();
    const wireEnc      = encryptPrivateKey(JSON.stringify(req.wireDetails));

    // Deduct balance atomically
    await this.db.query(
      `UPDATE fp_accounts
       SET balance_usdc = balance_usdc - $1, updated_at = now()
       WHERE id = $2`,
      [req.amountUsd, req.accountId],
    );

    // Submit Circle payout
    let circlePayoutId: string | undefined;
    let status: WithdrawalRecord['status'] = 'processing';

    try {
      const payout = await this.circle.createPayout(
        `wd-${withdrawalId}`,
        req.wireDetails,
        netAmount.toFixed(2),
      );
      circlePayoutId = payout.id;
    } catch (err) {
      console.error('[withdrawal-manager] Circle payout failed, reverting balance:', err);
      // Revert balance on Circle error
      await this.db.query(
        `UPDATE fp_accounts SET balance_usdc = balance_usdc + $1, updated_at = now() WHERE id = $2`,
        [req.amountUsd, req.accountId],
      );
      throw err;
    }

    await this.db.query(
      `INSERT INTO fp_withdrawals
         (id, account_id, merchant_id, amount_usd, fee_usd, net_amount_usd,
          wire_details_enc, circle_payout_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        withdrawalId, req.accountId, req.merchantId,
        req.amountUsd, feeUsd, netAmount,
        wireEnc, circlePayoutId ?? null, status,
      ],
    );

    const result = await this.db.query(`SELECT * FROM fp_withdrawals WHERE id = $1`, [withdrawalId]);
    return toRecord(result.rows[0] as Record<string, unknown>);
  }

  async checkWithdrawalStatus(withdrawalId: string): Promise<WithdrawalRecord> {
    const result = await this.db.query(`SELECT * FROM fp_withdrawals WHERE id = $1`, [withdrawalId]);
    if (result.rows.length === 0) throw new Error(`Withdrawal ${withdrawalId} not found`);
    const wd = toRecord(result.rows[0] as Record<string, unknown>);

    // Only poll Circle for non-terminal states that have a payout ID
    if (!wd.circlePayoutId || wd.status === 'completed' || wd.status === 'failed') {
      return wd;
    }

    let circlePayout;
    try {
      circlePayout = await this.circle.getPayout(wd.circlePayoutId);
    } catch (err) {
      console.warn('[withdrawal-manager] Could not poll Circle for payout status:', err);
      return wd;
    }

    const newStatus: WithdrawalRecord['status'] =
      circlePayout.status === 'complete' ? 'completed' :
      circlePayout.status === 'failed'   ? 'failed'    :
      wd.status;

    if (newStatus !== wd.status) {
      await this.db.query(
        `UPDATE fp_withdrawals
         SET status = $1, completed_at = CASE WHEN $1 = 'completed' THEN now() ELSE completed_at END,
             updated_at = now()
         WHERE id = $2`,
        [newStatus, withdrawalId],
      );
      wd.status = newStatus;
      if (newStatus === 'completed') wd.completedAt = new Date().toISOString();
    }

    return wd;
  }
}

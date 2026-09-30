import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from './database.tokens';

// Transaction metadata to persist alongside the immutable audit trail.
export interface TransactionRecord {
  requestId: string;
  customerId: string;
  chain: string;
  to: string;
  data: string;
  value: string;
  gasLimit?: number;
  gasPrice: string;
  nonce?: number | null;
  signedTx: string;
  txHash: string | null;
  status: string;
  fromAddress?: string | null;
  chainId?: number | null;
  statusDetail?: string | null;
}

// Reads and writes rows in the signing.transactions table.
@Injectable()
export class PostgresService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // Upserts a transaction keyed by request_id so retries update in place.
  async saveTransaction(tx: TransactionRecord) {
    const query = `
      INSERT INTO signing.transactions (
        request_id, customer_id, chain, to_address, amount, data,
        gas_limit, gas_price, nonce, signed_tx, tx_hash, status,
        from_address, chain_id, status_detail
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (request_id)
      DO UPDATE SET
        -- Nonce, gas, fees and chain are decided at signing time for transfers that
        -- waited for approval, so the signed row overwrites the queued one.
        gas_limit = EXCLUDED.gas_limit,
        gas_price = EXCLUDED.gas_price,
        nonce = EXCLUDED.nonce,
        signed_tx = EXCLUDED.signed_tx,
        tx_hash = EXCLUDED.tx_hash,
        status = EXCLUDED.status,
        from_address = EXCLUDED.from_address,
        chain_id = EXCLUDED.chain_id,
        status_detail = EXCLUDED.status_detail,
        updated_at = NOW()
    `;

    await this.pool.query(query, [
      tx.requestId,
      tx.customerId,
      tx.chain,
      tx.to,
      tx.value,
      tx.data,
      tx.gasLimit ?? null,
      tx.gasPrice,
      tx.nonce ?? null,
      tx.signedTx,
      tx.txHash,
      tx.status,
      tx.fromAddress ?? null,
      tx.chainId ?? null,
      tx.statusDetail ?? null,
    ]);
  }

  // Updates only the lifecycle status (e.g. signed -> broadcasted -> confirmed).
  async updateStatus(requestId: string, status: string, txHash?: string, detail?: string | null) {
    // `detail` (a broadcast error, failure reason...) is replaced on every call so a
    // stale error never outlives the state it described. broadcast_at is stamped when
    // the network accepts the transaction; the stuck timeout counts from there.
    const query = `
      UPDATE signing.transactions
      SET status = $2::varchar, tx_hash = COALESCE($3, tx_hash), status_detail = $4,
          broadcast_at = CASE WHEN $2::varchar = 'broadcasted' THEN NOW() ELSE broadcast_at END,
          updated_at = NOW()
      WHERE request_id = $1
    `;
    await this.pool.query(query, [requestId, status, txHash ?? null, detail ?? null]);
  }

  // Fetches a transaction, scoped to a tenant when customerId is provided so a
  // customer can never read another tenant's transaction.
  async getTransaction(requestId: string, customerId?: string) {
    const result = customerId
      ? await this.pool.query(
          `SELECT * FROM signing.transactions WHERE request_id = $1 AND customer_id = $2`,
          [requestId, customerId],
        )
      : await this.pool.query(
          `SELECT * FROM signing.transactions WHERE request_id = $1`,
          [requestId],
        );
    return result.rows[0] ?? null;
  }

  // Lists a tenant's transactions, most recent first.
  async listTransactions(customerId: string, limit = 100) {
    const result = await this.pool.query(
      `SELECT * FROM signing.transactions
       WHERE customer_id = $1 ORDER BY id DESC LIMIT $2`,
      [customerId, limit],
    );
    return result.rows;
  }
}

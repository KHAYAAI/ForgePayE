import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { FraudDetectionManager } from './fraud-detection-manager.js';
import type { RoutingManager, RouteDecision } from './routing-manager.js';
import type { ZkProofManager } from './zk-proof-manager.js';
import { buildEvent, forwardToUnifiedRouter } from './events.js';

export type TransactionType   = 'deposit' | 'withdrawal' | 'internal_transfer';
export type TransactionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'blocked';

export class TransactionBlockedError extends Error {
  constructor(
    public readonly transactionId: string,
    public readonly riskScore: number,
    public readonly riskFactors: string[],
  ) {
    super(`Transaction ${transactionId} blocked by fraud detection (score: ${riskScore})`);
    this.name = 'TransactionBlockedError';
  }
}

export interface TransactionRecord {
  id:             string;
  accountId:      string;
  merchantId:     string;
  type:           TransactionType;
  amountUsd:      number;
  amountUnits:    string;
  token:          'USDC' | 'USDT';
  chain:          string;
  status:         TransactionStatus;
  riskScore?:     number;
  fraudDecision?: 'allow' | 'review' | 'block';
  zkProof?:       string;
  commitment?:    string;
  txHash?:        string;
  depositId?:     string;
  withdrawalId?:  string;
  routeInfo?:     RouteDecision;
  errorMessage?:  string;
  createdAt:      string;
  completedAt?:   string;
}

export interface CreateTransactionRequest {
  accountId:           string;
  merchantId:          string;
  type:                TransactionType;
  amountUsd:           number;
  chain?:              string;
  token?:              'USDC' | 'USDT';
  destinationAddress?: string;
  metadata?:           Record<string, unknown>;
}

function toRecord(row: Record<string, unknown>): TransactionRecord {
  return {
    id:            row['id'] as string,
    accountId:     row['account_id'] as string,
    merchantId:    row['merchant_id'] as string,
    type:          row['type'] as TransactionType,
    amountUsd:     parseFloat(row['amount_usd'] as string),
    amountUnits:   row['amount_units'] as string,
    token:         row['token'] as 'USDC' | 'USDT',
    chain:         row['chain'] as string,
    status:        row['status'] as TransactionStatus,
    riskScore:     row['risk_score'] ? parseFloat(row['risk_score'] as string) : undefined,
    fraudDecision: row['fraud_decision'] as 'allow' | 'review' | 'block' | undefined,
    zkProof:       row['zk_proof'] as string | undefined,
    commitment:    row['commitment'] as string | undefined,
    txHash:        row['tx_hash'] as string | undefined,
    depositId:     row['deposit_id'] as string | undefined,
    withdrawalId:  row['withdrawal_id'] as string | undefined,
    routeInfo:     row['route_info'] ? (row['route_info'] as RouteDecision) : undefined,
    errorMessage:  row['error_message'] as string | undefined,
    createdAt:     (row['created_at'] as Date).toISOString(),
    completedAt:   row['completed_at'] ? (row['completed_at'] as Date).toISOString() : undefined,
  };
}

export class TransactionManager {
  constructor(
    private readonly db:             Pool,
    private readonly fraudDetection: FraudDetectionManager,
    private readonly routing:        RoutingManager,
    private readonly zkProofs:       ZkProofManager,
  ) {}

  async createTransaction(req: CreateTransactionRequest): Promise<TransactionRecord> {
    const txId       = randomUUID();
    const token      = req.token ?? 'USDC';
    const amountUnits = Math.round(req.amountUsd * 1_000_000).toString();

    // 1. Fraud assessment
    const fraud = await this.fraudDetection.assess({
      transactionId: txId,
      accountId:     req.accountId,
      amountUsd:     req.amountUsd,
      chain:         req.chain ?? 'polygon',
      destinationAddress: req.destinationAddress,
    });

    if (fraud.decision === 'block') {
      // Persist blocked record for audit trail
      await this.db.query(
        `INSERT INTO fp_account_transactions
           (id, account_id, merchant_id, type, amount_usd, amount_units, token, chain,
            status, risk_score, fraud_decision, error_message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'blocked',$9,'block','Blocked by fraud detection')`,
        [txId, req.accountId, req.merchantId, req.type,
         req.amountUsd, amountUnits, token, req.chain ?? 'polygon',
         fraud.riskScore],
      );

      await forwardToUnifiedRouter(buildEvent(
        'account.fraud.blocked', req.merchantId, req.accountId,
        { transactionId: txId, riskScore: fraud.riskScore, riskFactors: fraud.riskFactors },
      ));

      throw new TransactionBlockedError(txId, fraud.riskScore, fraud.riskFactors);
    }

    // 2. Route selection
    const route = this.routing.selectRoute({
      amountUsd:      req.amountUsd,
      preferredChain: req.chain,
      merchantId:     req.merchantId,
      accountId:      req.accountId,
    });

    // 3. ZK proof generation (Phase 2)
    let zkProof:    string | undefined;
    let commitment: string | undefined;

    try {
      const proof = await this.zkProofs.generateDepositProof({
        accountId:   req.accountId,
        amountUnits: BigInt(amountUnits),
        assetId:     token === 'USDC' ? 1n : 2n,
      });
      zkProof    = proof.proof;
      commitment = proof.commitment;
    } catch (err) {
      console.warn('[transaction-manager] ZK proof generation failed (non-fatal):', err);
    }

    // 4. Persist transaction record
    await this.db.query(
      `INSERT INTO fp_account_transactions
         (id, account_id, merchant_id, type, amount_usd, amount_units, token, chain,
          status, risk_score, fraud_decision, zk_proof, commitment, route_info)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12,$13)`,
      [
        txId, req.accountId, req.merchantId, req.type,
        req.amountUsd, amountUnits, token, route.chain,
        fraud.riskScore, fraud.decision,
        zkProof ?? null, commitment ?? null,
        JSON.stringify(route),
      ],
    );

    // 5. Forward event
    const eventType = req.type === 'deposit'
      ? 'account.deposit.initiated'
      : 'account.withdrawal.initiated';

    await forwardToUnifiedRouter(buildEvent(
      eventType, req.merchantId, req.accountId,
      { transactionId: txId, amountUsd: req.amountUsd, chain: route.chain, token },
    ));

    const result = await this.db.query(`SELECT * FROM fp_account_transactions WHERE id=$1`, [txId]);
    return toRecord(result.rows[0] as Record<string, unknown>);
  }

  async getTransaction(txId: string): Promise<TransactionRecord | null> {
    const result = await this.db.query(`SELECT * FROM fp_account_transactions WHERE id=$1`, [txId]);
    if (result.rows.length === 0) return null;
    return toRecord(result.rows[0] as Record<string, unknown>);
  }

  async listTransactions(accountId: string, limit = 50): Promise<TransactionRecord[]> {
    const result = await this.db.query(
      `SELECT * FROM fp_account_transactions WHERE account_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [accountId, Math.min(limit, 200)],
    );
    return (result.rows as Record<string, unknown>[]).map(toRecord);
  }

  async updateStatus(txId: string, status: TransactionStatus, txHash?: string): Promise<void> {
    await this.db.query(
      `UPDATE fp_account_transactions
       SET status=$1, tx_hash=COALESCE($2, tx_hash),
           completed_at=CASE WHEN $1 IN ('completed','failed','blocked') THEN now() ELSE completed_at END
       WHERE id=$3`,
      [status, txHash ?? null, txId],
    );
  }
}

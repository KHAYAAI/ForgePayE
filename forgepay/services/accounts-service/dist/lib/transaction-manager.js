import { randomUUID } from 'node:crypto';
import { buildEvent, forwardToUnifiedRouter } from './events.js';
export class TransactionBlockedError extends Error {
    transactionId;
    riskScore;
    riskFactors;
    constructor(transactionId, riskScore, riskFactors) {
        super(`Transaction ${transactionId} blocked by fraud detection (score: ${riskScore})`);
        this.transactionId = transactionId;
        this.riskScore = riskScore;
        this.riskFactors = riskFactors;
        this.name = 'TransactionBlockedError';
    }
}
function toRecord(row) {
    return {
        id: row['id'],
        accountId: row['account_id'],
        merchantId: row['merchant_id'],
        type: row['type'],
        amountUsd: parseFloat(row['amount_usd']),
        amountUnits: row['amount_units'],
        token: row['token'],
        chain: row['chain'],
        status: row['status'],
        riskScore: row['risk_score'] ? parseFloat(row['risk_score']) : undefined,
        fraudDecision: row['fraud_decision'],
        zkProof: row['zk_proof'],
        commitment: row['commitment'],
        txHash: row['tx_hash'],
        depositId: row['deposit_id'],
        withdrawalId: row['withdrawal_id'],
        routeInfo: row['route_info'] ? row['route_info'] : undefined,
        errorMessage: row['error_message'],
        createdAt: row['created_at'].toISOString(),
        completedAt: row['completed_at'] ? row['completed_at'].toISOString() : undefined,
    };
}
export class TransactionManager {
    db;
    fraudDetection;
    routing;
    zkProofs;
    constructor(db, fraudDetection, routing, zkProofs) {
        this.db = db;
        this.fraudDetection = fraudDetection;
        this.routing = routing;
        this.zkProofs = zkProofs;
    }
    async createTransaction(req) {
        const txId = randomUUID();
        const token = req.token ?? 'USDC';
        const amountUnits = Math.round(req.amountUsd * 1_000_000).toString();
        // 1. Fraud assessment
        const fraud = await this.fraudDetection.assess({
            transactionId: txId,
            accountId: req.accountId,
            amountUsd: req.amountUsd,
            chain: req.chain ?? 'polygon',
            destinationAddress: req.destinationAddress,
        });
        if (fraud.decision === 'block') {
            // Persist blocked record for audit trail
            await this.db.query(`INSERT INTO fp_account_transactions
           (id, account_id, merchant_id, type, amount_usd, amount_units, token, chain,
            status, risk_score, fraud_decision, error_message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'blocked',$9,'block','Blocked by fraud detection')`, [txId, req.accountId, req.merchantId, req.type,
                req.amountUsd, amountUnits, token, req.chain ?? 'polygon',
                fraud.riskScore]);
            await forwardToUnifiedRouter(buildEvent('account.fraud.blocked', req.merchantId, req.accountId, { transactionId: txId, riskScore: fraud.riskScore, riskFactors: fraud.riskFactors }));
            throw new TransactionBlockedError(txId, fraud.riskScore, fraud.riskFactors);
        }
        // 2. Route selection
        const route = this.routing.selectRoute({
            amountUsd: req.amountUsd,
            preferredChain: req.chain,
            merchantId: req.merchantId,
            accountId: req.accountId,
        });
        // 3. ZK proof generation (Phase 2)
        let zkProof;
        let commitment;
        try {
            const proof = await this.zkProofs.generateDepositProof({
                accountId: req.accountId,
                amountUnits: BigInt(amountUnits),
                assetId: token === 'USDC' ? 1n : 2n,
            });
            zkProof = proof.proof;
            commitment = proof.commitment;
        }
        catch (err) {
            console.warn('[transaction-manager] ZK proof generation failed (non-fatal):', err);
        }
        // 4. Persist transaction record
        await this.db.query(`INSERT INTO fp_account_transactions
         (id, account_id, merchant_id, type, amount_usd, amount_units, token, chain,
          status, risk_score, fraud_decision, zk_proof, commitment, route_info)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12,$13)`, [
            txId, req.accountId, req.merchantId, req.type,
            req.amountUsd, amountUnits, token, route.chain,
            fraud.riskScore, fraud.decision,
            zkProof ?? null, commitment ?? null,
            JSON.stringify(route),
        ]);
        // 5. Forward event
        const eventType = req.type === 'deposit'
            ? 'account.deposit.initiated'
            : 'account.withdrawal.initiated';
        await forwardToUnifiedRouter(buildEvent(eventType, req.merchantId, req.accountId, { transactionId: txId, amountUsd: req.amountUsd, chain: route.chain, token }));
        const result = await this.db.query(`SELECT * FROM fp_account_transactions WHERE id=$1`, [txId]);
        return toRecord(result.rows[0]);
    }
    async getTransaction(txId) {
        const result = await this.db.query(`SELECT * FROM fp_account_transactions WHERE id=$1`, [txId]);
        if (result.rows.length === 0)
            return null;
        return toRecord(result.rows[0]);
    }
    async listTransactions(accountId, limit = 50) {
        const result = await this.db.query(`SELECT * FROM fp_account_transactions WHERE account_id=$1 ORDER BY created_at DESC LIMIT $2`, [accountId, Math.min(limit, 200)]);
        return result.rows.map(toRecord);
    }
    async updateStatus(txId, status, txHash) {
        await this.db.query(`UPDATE fp_account_transactions
       SET status=$1, tx_hash=COALESCE($2, tx_hash),
           completed_at=CASE WHEN $1 IN ('completed','failed','blocked') THEN now() ELSE completed_at END
       WHERE id=$3`, [status, txHash ?? null, txId]);
    }
}
//# sourceMappingURL=transaction-manager.js.map
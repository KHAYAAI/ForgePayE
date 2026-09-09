import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
function toRecord(row) {
    return {
        id: row['id'],
        accountId: row['account_id'],
        merchantId: row['merchant_id'],
        amountUsd: parseFloat(row['amount_usd']),
        amountUnits: row['amount_units'],
        chain: row['chain'],
        depositAddress: row['deposit_address'],
        circleIntentId: row['circle_intent_id'],
        status: row['status'],
        txHash: row['tx_hash'],
        createdAt: row['created_at'].toISOString(),
        confirmedAt: row['confirmed_at'] ? row['confirmed_at'].toISOString() : undefined,
        expiresAt: row['expires_at'].toISOString(),
    };
}
export class DepositManager {
    db;
    circle;
    wallets;
    constructor(db, circle, wallets) {
        this.db = db;
        this.circle = circle;
        this.wallets = wallets;
    }
    async createDeposit(req) {
        const chain = req.chain ?? config.accounts.defaultChain;
        const amountUnits = Math.round(req.amountUsd * 1_000_000).toString();
        const depositId = randomUUID();
        const expiresAt = new Date(Date.now() + config.accounts.depositTtlSeconds * 1000).toISOString();
        // Generate a Circle payment intent (USD deposit address)
        let depositAddress = '';
        let circleIntentId;
        try {
            const intent = await this.circle.createPaymentIntent({
                idempotencyKey: `dep-${depositId}`,
                amountUsd: req.amountUsd.toFixed(2),
                chain,
            });
            depositAddress = intent.depositAddress.address;
            circleIntentId = intent.id;
        }
        catch (err) {
            console.warn('[deposit-manager] Circle intent failed, falling back to direct wallet:', err);
            // Fall back to a direct on-chain address if Circle is unavailable
            const wallet = await this.wallets.generateWallet(chain);
            depositAddress = wallet.address;
            // Store the wallet for later sweeping
            await this.db.query(`UPDATE fp_accounts SET wallet_address = $1, encrypted_key = $2 WHERE id = $3 AND wallet_address IS NULL`, [wallet.address, wallet.encryptedKey, req.accountId]);
        }
        await this.db.query(`INSERT INTO fp_deposits
         (id, account_id, merchant_id, amount_usd, amount_units, chain, deposit_address,
          circle_intent_id, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`, [
            depositId, req.accountId, req.merchantId,
            req.amountUsd, amountUnits, chain, depositAddress,
            circleIntentId ?? null, expiresAt,
        ]);
        const result = await this.db.query(`SELECT * FROM fp_deposits WHERE id = $1`, [depositId]);
        return toRecord(result.rows[0]);
    }
    async checkDepositStatus(depositId) {
        const result = await this.db.query(`SELECT * FROM fp_deposits WHERE id = $1`, [depositId]);
        if (result.rows.length === 0)
            throw new Error(`Deposit ${depositId} not found`);
        const deposit = toRecord(result.rows[0]);
        if (deposit.status !== 'pending' && deposit.status !== 'processing') {
            return deposit; // Already settled
        }
        if (!deposit.circleIntentId)
            return deposit;
        try {
            const intent = await this.circle.getPaymentIntent(deposit.circleIntentId);
            if (intent.status === 'complete') {
                await this.db.query(`UPDATE fp_deposits SET status = 'confirmed', confirmed_at = now()
           WHERE id = $1 AND status != 'confirmed'`, [depositId]);
                await this.db.query(`UPDATE fp_accounts
           SET balance_usdc = balance_usdc + $1::numeric / 1000000,
               updated_at   = now()
           WHERE id = $2`, [deposit.amountUnits, deposit.accountId]);
                return { ...deposit, status: 'confirmed', confirmedAt: new Date().toISOString() };
            }
        }
        catch (err) {
            console.error('[deposit-manager] Failed to check Circle intent status:', err);
        }
        return deposit;
    }
    async confirmDirectDeposit(depositId, txHash) {
        const result = await this.db.query(`SELECT * FROM fp_deposits WHERE id = $1`, [depositId]);
        if (result.rows.length === 0)
            throw new Error(`Deposit ${depositId} not found`);
        const deposit = toRecord(result.rows[0]);
        await this.db.query(`UPDATE fp_deposits SET status = 'confirmed', tx_hash = $1, confirmed_at = now() WHERE id = $2`, [txHash, depositId]);
        await this.db.query(`UPDATE fp_accounts
       SET balance_usdc = balance_usdc + $1::numeric / 1000000, updated_at = now()
       WHERE id = $2`, [deposit.amountUnits, deposit.accountId]);
        return { ...deposit, status: 'confirmed', txHash, confirmedAt: new Date().toISOString() };
    }
}
//# sourceMappingURL=deposit-manager.js.map
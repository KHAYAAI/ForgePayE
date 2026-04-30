import type { FastifyInstance } from 'fastify';
import { getDb } from '../lib/db.js';
import { DepositManager } from '../lib/deposit-manager.js';
import { WithdrawalManager } from '../lib/withdrawal-manager.js';
import { TransactionManager, TransactionBlockedError } from '../lib/transaction-manager.js';
import { FraudDetectionManager } from '../lib/fraud-detection-manager.js';
import { RoutingManager } from '../lib/routing-manager.js';
import { ZkProofManager } from '../lib/zk-proof-manager.js';
import { WalletManager } from '../lib/wallet-manager.js';
import { CircleClient } from '../lib/circle-client.js';
import { encryptPrivateKey } from '../lib/keystore.js';
import { buildEvent, forwardToUnifiedRouter } from '../lib/events.js';
import { config } from '../config.js';

interface DepositBody {
  amount_usd: number;
  chain?:     string;
}

interface WithdrawalBody {
  amount_usd:          number;
  wire_account_number: string;
  wire_routing_number: string;
  billing_name:        string;
}

async function requireKycApproved(db: ReturnType<typeof getDb>, accountId: string): Promise<string> {
  const result = await db.query(
    `SELECT kyc_status, merchant_id FROM fp_accounts WHERE id=$1`, [accountId],
  );
  if (result.rows.length === 0) throw { statusCode: 404, message: 'Account not found' };
  const row = result.rows[0] as Record<string, unknown>;
  if (row['kyc_status'] !== 'approved') {
    throw { statusCode: 403, message: 'KYC verification required', kyc_status: row['kyc_status'] };
  }
  return row['merchant_id'] as string;
}

export async function buildTransactionRoutes(app: FastifyInstance) {
  const db      = getDb();
  const wallets = new WalletManager();
  const circle  = new CircleClient(config.circle.apiKey, config.circle.baseUrl, config.env !== 'production');

  const deposits     = new DepositManager(db, circle, wallets);
  const withdrawals  = new WithdrawalManager(db, circle);
  const fraud        = new FraudDetectionManager(db);
  const routing      = new RoutingManager();
  const zkProofs     = new ZkProofManager();
  const transactions = new TransactionManager(db, fraud, routing, zkProofs);

  // ── POST /v1/accounts/:id/deposits ────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: DepositBody }>('/:id/deposits', {
    schema: {
      body: {
        type: 'object',
        required: ['amount_usd'],
        properties: {
          amount_usd: { type: 'number', minimum: 10, maximum: 50000 },
          chain:      { type: 'string', enum: ['polygon', 'base', 'ethereum', 'arbitrum'] },
        },
      },
    },
  }, async (req, reply) => {
    let merchantId: string;
    try {
      merchantId = await requireKycApproved(db, req.params.id);
    } catch (err: unknown) {
      const e = err as { statusCode: number; message: string; kyc_status?: string };
      reply.code(e.statusCode).send({ error: e.message, kyc_status: e.kyc_status });
      return;
    }

    // Create transaction record first (for fraud tracking)
    let txRecord;
    try {
      txRecord = await transactions.createTransaction({
        accountId:  req.params.id,
        merchantId,
        type:       'deposit',
        amountUsd:  req.body.amount_usd,
        chain:      req.body.chain,
      });
    } catch (err) {
      if (err instanceof TransactionBlockedError) {
        reply.code(403).send({
          error:        'Transaction blocked by fraud detection',
          risk_score:   err.riskScore,
          risk_factors: err.riskFactors,
        });
        return;
      }
      throw err;
    }

    const deposit = await deposits.createDeposit({
      accountId:  req.params.id,
      merchantId,
      amountUsd:  req.body.amount_usd,
      chain:      req.body.chain,
    });

    // Link deposit to transaction
    await db.query(
      `UPDATE fp_account_transactions SET deposit_id=$1 WHERE id=$2`,
      [deposit.id, txRecord.id],
    );

    await forwardToUnifiedRouter(buildEvent(
      'account.deposit.initiated', merchantId, req.params.id,
      { depositId: deposit.id, transactionId: txRecord.id, amountUsd: deposit.amountUsd, chain: deposit.chain },
    ));

    reply.code(201).send({ ...deposit, transaction_id: txRecord.id });
  });

  // ── GET /v1/accounts/:id/deposits/:depositId ───────────────────────────────
  app.get<{ Params: { id: string; depositId: string } }>('/:id/deposits/:depositId', async (req, reply) => {
    const updated = await deposits.checkDepositStatus(req.params.depositId);
    if (updated.accountId !== req.params.id) {
      reply.code(404).send({ error: 'Deposit not found' });
      return;
    }
    reply.send(updated);
  });

  // ── GET /v1/accounts/:id/deposits ─────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/:id/deposits', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    const result = await db.query(
      `SELECT id, account_id, merchant_id, amount_usd, amount_units, chain, deposit_address,
              status, tx_hash, created_at, confirmed_at, expires_at
       FROM fp_deposits WHERE account_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [req.params.id, limit],
    );
    reply.send({ data: result.rows });
  });

  // ── POST /v1/accounts/:id/withdrawals ─────────────────────────────────────
  app.post<{ Params: { id: string }; Body: WithdrawalBody }>('/:id/withdrawals', {
    schema: {
      body: {
        type: 'object',
        required: ['amount_usd', 'wire_account_number', 'wire_routing_number', 'billing_name'],
        properties: {
          amount_usd:          { type: 'number', minimum: 10 },
          wire_account_number: { type: 'string' },
          wire_routing_number: { type: 'string' },
          billing_name:        { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    let merchantId: string;
    try {
      merchantId = await requireKycApproved(db, req.params.id);
    } catch (err: unknown) {
      const e = err as { statusCode: number; message: string; kyc_status?: string };
      reply.code(e.statusCode).send({ error: e.message, kyc_status: e.kyc_status });
      return;
    }

    try {
      const withdrawal = await withdrawals.initiateWithdrawal({
        accountId:  req.params.id,
        merchantId,
        amountUsd:  req.body.amount_usd,
        wireDetails: {
          accountNumber: req.body.wire_account_number,
          routingNumber: req.body.wire_routing_number,
          billingName:   req.body.billing_name,
        },
      });

      await forwardToUnifiedRouter(buildEvent(
        'account.withdrawal.initiated', merchantId, req.params.id,
        { withdrawalId: withdrawal.id, amountUsd: withdrawal.amountUsd, feeUsd: withdrawal.feeUsd },
      ));

      reply.code(201).send(withdrawal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Withdrawal failed';
      reply.code(400).send({ error: message });
    }
  });

  // ── GET /v1/accounts/:id/withdrawals/:withdrawalId ────────────────────────
  app.get<{ Params: { id: string; withdrawalId: string } }>('/:id/withdrawals/:withdrawalId', async (req, reply) => {
    const wd = await withdrawals.checkWithdrawalStatus(req.params.withdrawalId);
    if (wd.accountId !== req.params.id) {
      reply.code(404).send({ error: 'Withdrawal not found' });
      return;
    }
    reply.send(wd);
  });

  // ── GET /v1/accounts/:id/transactions ─────────────────────────────────────
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; type?: string; status?: string };
  }>('/:id/transactions', async (req, reply) => {
    const limit  = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    const { type, status } = req.query;

    let query  = `SELECT * FROM fp_account_transactions WHERE account_id=$1`;
    const args: unknown[] = [req.params.id];

    if (type)   { args.push(type);   query += ` AND type=$${args.length}`; }
    if (status) { args.push(status); query += ` AND status=$${args.length}`; }

    query += ` ORDER BY created_at DESC LIMIT $${args.length + 1}`;
    args.push(limit);

    const result = await db.query(query, args);
    reply.send({ data: result.rows });
  });
}

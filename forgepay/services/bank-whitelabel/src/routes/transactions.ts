/**
 * Bank Transaction Routes
 *
 * Transaction records are created by the webhook handler when the crypto-gateway
 * or stablecoin-gateway confirms a payment. All reads are scoped to the
 * authenticated admin's bankId.
 *
 * Daily transaction limits are enforced per customer: the sum of confirmed +
 * pending transactions created today (UTC) must not exceed customer.dailyLimitUsd.
 *
 * Routes:
 *   GET  /v1/transactions      — list transactions for this bank (paginated)
 *   GET  /v1/transactions/:id  — get transaction details
 *   POST /v1/transactions      — create transaction record
 */

import type { FastifyInstance } from 'fastify';
import { Transactions, Customers, AuditLog } from '../store.js';
import { authenticate, extractBankId, extractRole, extractAdminId, extractIp } from '../auth.js';
import { randomUUID } from 'node:crypto';
import { BankTransaction } from '../types.js';

export async function registerTransactionRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /v1/transactions ──────────────────────────────────────────────────
  app.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      status?: BankTransaction['status'];
      type?: BankTransaction['type'];
    };
  }>(
    '/v1/transactions',
    {
      preHandler: [authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit:  { type: 'string' },
            offset: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'confirmed', 'failed', 'refunded'] },
            type:   { type: 'string', enum: ['crypto_purchase', 'crypto_sale', 'stablecoin_deposit', 'stablecoin_withdrawal'] },
          },
        },
      },
    },
    async (request, reply) => {
      const bankId = extractBankId(request);
      const limit  = Math.min(parseInt(request.query.limit  ?? '50', 10), 200);
      const offset = Math.max(parseInt(request.query.offset ?? '0',  10), 0);

      let data  = Transactions.findByBank(bankId, limit + offset, 0);
      const total = Transactions.countByBank(bankId);

      if (request.query.status) data = data.filter(t => t.status === request.query.status);
      if (request.query.type)   data = data.filter(t => t.type   === request.query.type);

      return reply.send({ data: data.slice(offset, offset + limit), total, limit, offset });
    },
  );

  // ── GET /v1/transactions/:id ──────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/v1/transactions/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const bankId = extractBankId(request);
      const txn    = Transactions.findById(request.params.id, bankId);
      if (!txn) return reply.status(404).send({ error: 'Transaction not found' });
      return reply.send(txn);
    },
  );

  // ── POST /v1/transactions ─────────────────────────────────────────────────
  app.post<{
    Body: {
      customerId:   string;
      type:         BankTransaction['type'];
      asset:        string;
      amountCrypto: number;
      amountUsd:    number;
      feeUsd:       number;
      txHash?:      string;
      status?:      BankTransaction['status'];
    };
  }>(
    '/v1/transactions',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['customerId', 'type', 'asset', 'amountCrypto', 'amountUsd', 'feeUsd'],
          properties: {
            customerId:   { type: 'string' },
            type:         { type: 'string', enum: ['crypto_purchase', 'crypto_sale', 'stablecoin_deposit', 'stablecoin_withdrawal'] },
            asset:        { type: 'string' },
            amountCrypto: { type: 'number', minimum: 0 },
            amountUsd:    { type: 'number', minimum: 0 },
            feeUsd:       { type: 'number', minimum: 0 },
            txHash:       { type: 'string' },
            status:       { type: 'string', enum: ['pending', 'confirmed', 'failed', 'refunded'] },
          },
        },
      },
    },
    async (request, reply) => {
      const role = extractRole(request);
      if (role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot create transactions' });
      }

      const bankId = extractBankId(request);
      const { customerId, type, asset, amountCrypto, amountUsd, feeUsd, txHash, status } = request.body;

      const customer = Customers.findById(customerId, bankId);
      if (!customer) {
        return reply.status(404).send({ error: 'Customer not found in this bank' });
      }

      if (customer.status === 'suspended') {
        return reply.status(422).send({ error: 'Customer is suspended — cannot create transaction' });
      }

      // KYC gate: only inherited or approved customers can transact
      if (customer.kycStatus === 'pending' || customer.kycStatus === 'rejected') {
        return reply.status(422).send({
          error: `KYC check required — customer status is '${customer.kycStatus}'`,
        });
      }

      // Daily transaction limit enforcement
      const todayVolumeUsd = Transactions.getTodayVolumeForCustomer(customerId, bankId);
      if (todayVolumeUsd + amountUsd > customer.dailyLimitUsd) {
        return reply.status(422).send({
          error:         'DailyLimitExceeded',
          message:       `Adding $${amountUsd.toLocaleString()} would exceed daily limit of $${customer.dailyLimitUsd.toLocaleString()}`,
          dailyLimitUsd: customer.dailyLimitUsd,
          todayUsedUsd:  todayVolumeUsd,
          remainingUsd:  Math.max(0, customer.dailyLimitUsd - todayVolumeUsd),
        });
      }

      const now = new Date().toISOString();
      const txn = Transactions.create({
        id:           randomUUID(),
        bankId,
        customerId,
        type,
        asset,
        amountCrypto,
        amountUsd,
        feeUsd,
        netAmountUsd: amountUsd - feeUsd,
        status:       status ?? 'pending',
        txHash,
        createdAt:    now,
        confirmedAt:  (status === 'confirmed') ? now : undefined,
      });

      if (status === 'confirmed') {
        Customers.update(customerId, bankId, {
          totalVolumeUsd:   customer.totalVolumeUsd + amountUsd,
          transactionCount: customer.transactionCount + 1,
        });
      }

      AuditLog.record({
        adminId:  extractAdminId(request),
        bankId,
        role,
        action:   'transaction.create',
        entityId: txn.id,
        details:  `${type} ${asset} $${amountUsd} for customer ${customerId}`,
        ip:       extractIp(request),
      });

      return reply.status(201).send(txn);
    },
  );
}

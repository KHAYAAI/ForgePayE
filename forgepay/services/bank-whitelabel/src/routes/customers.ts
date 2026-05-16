/**
 * Bank Customer Management Routes
 *
 * All routes are scoped to the authenticated admin's bankId.
 * Bank A cannot read or modify Bank B's customers.
 *
 * When KYC status changes, a webhook is fired to the bank's configured webhookUrl
 * so the bank's own systems can update their customer record accordingly.
 *
 * Routes:
 *   GET    /v1/customers               — list customers (paginated)
 *   GET    /v1/customers/:id           — customer details + transaction history
 *   POST   /v1/customers               — onboard new customer
 *   PUT    /v1/customers/:id           — update customer status/limits
 *   POST   /v1/customers/:id/suspend   — suspend customer
 */

import type { FastifyInstance } from 'fastify';
import { Customers, Transactions, Banks, AuditLog } from '../store.js';
import { authenticate, extractBankId, extractRole, extractAdminId, extractIp } from '../auth.js';
import { randomUUID, createHmac } from 'node:crypto';
import { BankCustomer, Bank } from '../types.js';

export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /v1/customers ─────────────────────────────────────────────────────
  app.get<{
    Querystring: { limit?: string; offset?: string };
  }>(
    '/v1/customers',
    {
      preHandler: [authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit:  { type: 'string' },
            offset: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const bankId = extractBankId(request);
      const limit  = Math.min(parseInt(request.query.limit  ?? '50',  10), 200);
      const offset = Math.max(parseInt(request.query.offset ?? '0',   10), 0);

      const data  = Customers.findByBank(bankId, limit, offset);
      const total = Customers.countByBank(bankId);

      return reply.send({ data, total, limit, offset });
    },
  );

  // ── GET /v1/customers/:id ─────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/v1/customers/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const bankId   = extractBankId(request);
      const customer = Customers.findById(request.params.id, bankId);
      if (!customer) {
        return reply.status(404).send({ error: 'Customer not found' });
      }

      const txHistory     = Transactions.findByCustomer(customer.id, bankId);
      const todayVolumeUsd = Transactions.getTodayVolumeForCustomer(customer.id, bankId);

      return reply.send({
        ...customer,
        todayVolumeUsd,
        remainingDailyUsd: Math.max(0, customer.dailyLimitUsd - todayVolumeUsd),
        transactions:      txHistory,
      });
    },
  );

  // ── POST /v1/customers ────────────────────────────────────────────────────
  app.post<{
    Body: {
      bankCustomerRef: string;
      email?:          string;
      phone?:          string;
      dailyLimitUsd?:  number;
      riskLevel?:      BankCustomer['riskLevel'];
    };
  }>(
    '/v1/customers',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['bankCustomerRef'],
          properties: {
            bankCustomerRef: { type: 'string', minLength: 1 },
            email:           { type: 'string', format: 'email' },
            phone:           { type: 'string' },
            dailyLimitUsd:   { type: 'number', minimum: 0 },
            riskLevel:       { type: 'string', enum: ['low', 'medium', 'high'] },
          },
        },
      },
    },
    async (request, reply) => {
      const role = extractRole(request);
      if (role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot onboard customers' });
      }

      const bankId = extractBankId(request);
      const bank   = Banks.findById(bankId);
      if (!bank) return reply.status(404).send({ error: 'Bank not found' });

      const { bankCustomerRef, email, phone, dailyLimitUsd, riskLevel } = request.body;

      if (Customers.findByRef(bankId, bankCustomerRef)) {
        return reply.status(409).send({
          error: `Customer with bankCustomerRef '${bankCustomerRef}' already exists`,
        });
      }

      const kycStatus        = bank.kycInherited ? 'inherited' : 'pending';
      const kycInheritedFrom = bank.kycInherited ? 'bank_kyc_system' : undefined;

      const customer = Customers.create({
        id:               randomUUID(),
        bankId,
        bankCustomerRef,
        email,
        phone,
        kycStatus,
        kycInheritedFrom,
        riskLevel:        riskLevel ?? 'low',
        dailyLimitUsd:    dailyLimitUsd ?? 10_000,
        totalVolumeUsd:   0,
        transactionCount: 0,
        createdAt:        new Date().toISOString(),
        status:           'active',
      });

      AuditLog.record({
        adminId:  extractAdminId(request),
        bankId,
        role,
        action:   'customer.create',
        entityId: customer.id,
        details:  `Onboarded ${bankCustomerRef} (kycStatus: ${kycStatus})`,
        ip:       extractIp(request),
      });

      return reply.status(201).send(customer);
    },
  );

  // ── PUT /v1/customers/:id ─────────────────────────────────────────────────
  app.put<{
    Params: { id: string };
    Body: Partial<Pick<BankCustomer, 'email' | 'phone' | 'riskLevel' | 'dailyLimitUsd' | 'kycStatus'>>;
  }>(
    '/v1/customers/:id',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          properties: {
            email:         { type: 'string', format: 'email' },
            phone:         { type: 'string' },
            riskLevel:     { type: 'string', enum: ['low', 'medium', 'high'] },
            dailyLimitUsd: { type: 'number', minimum: 0 },
            kycStatus:     { type: 'string', enum: ['inherited', 'pending', 'approved', 'rejected'] },
          },
        },
      },
    },
    async (request, reply) => {
      const role = extractRole(request);
      if (role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot update customers' });
      }

      const bankId          = extractBankId(request);
      const previousCustomer = Customers.findById(request.params.id, bankId);
      const updated         = Customers.update(request.params.id, bankId, request.body);
      if (!updated) {
        return reply.status(404).send({ error: 'Customer not found' });
      }

      AuditLog.record({
        adminId:  extractAdminId(request),
        bankId,
        role,
        action:   'customer.update',
        entityId: updated.id,
        details:  `Updated fields: ${Object.keys(request.body).join(', ')}`,
        ip:       extractIp(request),
      });

      // Fire KYC webhook if status changed
      if (
        request.body.kycStatus &&
        previousCustomer &&
        request.body.kycStatus !== previousCustomer.kycStatus
      ) {
        const bank = Banks.findById(bankId);
        if (bank) {
          fireKycWebhook(bank, updated, request.body.kycStatus).catch(() => {});
        }
      }

      return reply.send(updated);
    },
  );

  // ── POST /v1/customers/:id/suspend ────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/v1/customers/:id/suspend',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const role = extractRole(request);
      if (role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot suspend customers' });
      }

      const bankId  = extractBankId(request);
      const updated = Customers.update(request.params.id, bankId, { status: 'suspended' });
      if (!updated) {
        return reply.status(404).send({ error: 'Customer not found' });
      }

      AuditLog.record({
        adminId:  extractAdminId(request),
        bankId,
        role,
        action:   'customer.suspend',
        entityId: updated.id,
        details:  `Customer ${updated.bankCustomerRef} suspended`,
        ip:       extractIp(request),
      });

      return reply.send({ message: 'Customer suspended', customer: updated });
    },
  );
}

// ── KYC status webhook ────────────────────────────────────────────────────────

async function fireKycWebhook(
  bank: Bank,
  customer: BankCustomer,
  newKycStatus: BankCustomer['kycStatus'],
): Promise<void> {
  if (!bank.webhookUrl) return;

  const payload = {
    event_type:        'customer.kyc_updated',
    bank_id:           bank.id,
    customer_ref:      customer.bankCustomerRef,
    customer_id:       customer.id,
    kyc_status:        newKycStatus,
    previous_status:   customer.kycStatus,
    timestamp:         new Date().toISOString(),
  };

  const sig = bank.webhookSigningKey
    ? createHmac('sha256', bank.webhookSigningKey).update(JSON.stringify(payload)).digest('hex')
    : undefined;

  const headers: Record<string, string> = {
    'Content-Type':  'application/json',
    'User-Agent':    'ForgePay-Bank-Whitelabel/0.2.0',
  };
  if (sig) headers['x-forgepay-bank-signature'] = sig;

  await fetch(bank.webhookUrl, {
    method:  'POST',
    headers,
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(10_000),
  });
}

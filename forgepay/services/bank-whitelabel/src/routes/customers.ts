/**
 * Bank Customer Management Routes
 *
 * All routes are scoped to the authenticated admin's bankId.
 * Bank A cannot read or modify Bank B's customers.
 *
 * Routes:
 *   GET    /v1/customers           — list customers for this bank (paginated)
 *   GET    /v1/customers/:id       — get customer details + transaction history
 *   POST   /v1/customers           — onboard new customer
 *   PUT    /v1/customers/:id       — update customer status/limits
 *   POST   /v1/customers/:id/suspend — suspend customer
 */

import type { FastifyInstance } from 'fastify';
import { Customers, Transactions, Banks } from '../store.js';
import { authenticate, extractBankId, extractRole } from '../auth.js';
import { randomUUID } from 'node:crypto';
import { BankCustomer } from '../types.js';

export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /v1/customers — list customers ────────────────────────────────────
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

  // ── GET /v1/customers/:id — get customer details ──────────────────────────
  app.get<{ Params: { id: string } }>(
    '/v1/customers/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const bankId   = extractBankId(request);
      const customer = Customers.findById(request.params.id, bankId);
      if (!customer) {
        return reply.status(404).send({ error: 'Customer not found' });
      }

      // Attach transaction history
      const txHistory = Transactions.findByCustomer(customer.id, bankId);

      return reply.send({ ...customer, transactions: txHistory });
    },
  );

  // ── POST /v1/customers — onboard new customer ─────────────────────────────
  app.post<{
    Body: {
      bankCustomerRef: string;
      email?: string;
      phone?: string;
      dailyLimitUsd?: number;
      riskLevel?: BankCustomer['riskLevel'];
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
      const role   = extractRole(request);
      if (role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot onboard customers' });
      }

      const bankId = extractBankId(request);
      const bank   = Banks.findById(bankId);
      if (!bank) return reply.status(404).send({ error: 'Bank not found' });

      const { bankCustomerRef, email, phone, dailyLimitUsd, riskLevel } = request.body;

      // Prevent duplicate customer references per bank
      if (Customers.findByRef(bankId, bankCustomerRef)) {
        return reply.status(409).send({
          error: `Customer with bankCustomerRef '${bankCustomerRef}' already exists`,
        });
      }

      // Determine KYC status based on bank's kycInherited flag
      const kycStatus = bank.kycInherited ? 'inherited' : 'pending';
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

      return reply.status(201).send(customer);
    },
  );

  // ── PUT /v1/customers/:id — update customer ───────────────────────────────
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

      const bankId   = extractBankId(request);
      const updated  = Customers.update(request.params.id, bankId, request.body);
      if (!updated) {
        return reply.status(404).send({ error: 'Customer not found' });
      }
      return reply.send(updated);
    },
  );

  // ── POST /v1/customers/:id/suspend — suspend customer ────────────────────
  app.post<{ Params: { id: string } }>(
    '/v1/customers/:id/suspend',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const role = extractRole(request);
      if (role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot suspend customers' });
      }

      const bankId = extractBankId(request);
      const updated = Customers.update(request.params.id, bankId, { status: 'suspended' });
      if (!updated) {
        return reply.status(404).send({ error: 'Customer not found' });
      }
      return reply.send({ message: 'Customer suspended', customer: updated });
    },
  );
}

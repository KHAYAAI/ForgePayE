/**
 * Bank Configuration Routes
 *
 * CRUD for bank tenants. Only super_admins can create or delete banks.
 * Regular admins can view and update their own bank's configuration.
 *
 * Routes:
 *   GET    /v1/banks          — list all banks (super_admin only)
 *   GET    /v1/banks/:id      — get bank details (scoped to own bank unless super_admin)
 *   POST   /v1/banks          — create new bank (super_admin only)
 *   PUT    /v1/banks/:id      — update bank configuration
 *   DELETE /v1/banks/:id      — suspend bank (super_admin only)
 */

import type { FastifyInstance } from 'fastify';
import { Banks } from '../store.js';
import { authenticate, extractBankId, extractRole } from '../auth.js';
import { randomUUID, randomBytes } from 'node:crypto';
import { Bank } from '../types.js';

export async function registerBankRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /v1/banks — list all banks ────────────────────────────────────────
  app.get(
    '/v1/banks',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const role = extractRole(request);
      if (role !== 'super_admin') {
        // Non-super admins can only see their own bank
        const bankId = extractBankId(request);
        const bank = Banks.findById(bankId);
        if (!bank) return reply.status(404).send({ error: 'Bank not found' });
        return reply.send({ data: [sanitizeBank(bank)] });
      }
      return reply.send({ data: Banks.findAll().map(sanitizeBank) });
    },
  );

  // ── GET /v1/banks/:id — get bank details ──────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/v1/banks/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const role   = extractRole(request);
      const bankId = extractBankId(request);
      const { id } = request.params;

      // Enforce tenant isolation: non-super_admins can only see their own bank
      if (role !== 'super_admin' && bankId !== id) {
        return reply.status(403).send({ error: 'Access denied — bank mismatch' });
      }

      const bank = Banks.findById(id);
      if (!bank) return reply.status(404).send({ error: 'Bank not found' });

      return reply.send(sanitizeBank(bank));
    },
  );

  // ── POST /v1/banks — create new bank ──────────────────────────────────────
  app.post<{
    Body: Omit<Bank, 'id' | 'createdAt' | 'webhookSigningKey'>;
  }>(
    '/v1/banks',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['name', 'slug', 'webhookFormat', 'kycInherited', 'amlLevel', 'settlementCurrency', 'settlementSchedule', 'adminEmails'],
          properties: {
            name:               { type: 'string', minLength: 2 },
            slug:               { type: 'string', pattern: '^[a-z0-9-]+$' },
            logoUrl:            { type: 'string' },
            primaryColor:       { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
            customDomain:       { type: 'string' },
            webhookUrl:         { type: 'string' },
            webhookFormat:      { type: 'string', enum: ['forgepay', 'iso20022', 'custom'] },
            kycInherited:       { type: 'boolean' },
            amlLevel:           { type: 'string', enum: ['inherited', 'standard', 'enhanced'] },
            settlementCurrency: { type: 'string' },
            settlementSchedule: { type: 'string', enum: ['daily', 'weekly'] },
            status:             { type: 'string', enum: ['active', 'suspended', 'pending'] },
            adminEmails:        { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const role = extractRole(request);
      if (role !== 'super_admin') {
        return reply.status(403).send({ error: 'Only super_admins can create banks' });
      }

      const body = request.body;

      // Ensure slug uniqueness
      if (Banks.findBySlug(body.slug)) {
        return reply.status(409).send({ error: `Bank with slug '${body.slug}' already exists` });
      }

      const bank = Banks.create({
        id:                 body.slug, // use slug as id for predictable URLs
        name:               body.name,
        slug:               body.slug,
        logoUrl:            body.logoUrl,
        primaryColor:       body.primaryColor,
        customDomain:       body.customDomain,
        webhookUrl:         body.webhookUrl,
        webhookFormat:      body.webhookFormat,
        webhookSigningKey:  randomBytes(32).toString('hex'),
        kycInherited:       body.kycInherited,
        amlLevel:           body.amlLevel,
        settlementCurrency: body.settlementCurrency,
        settlementSchedule: body.settlementSchedule,
        createdAt:          new Date().toISOString(),
        status:             body.status ?? 'pending',
        adminEmails:        body.adminEmails ?? [],
      });

      return reply.status(201).send(sanitizeBank(bank));
    },
  );

  // ── PUT /v1/banks/:id — update bank configuration ─────────────────────────
  app.put<{
    Params: { id: string };
    Body: Partial<Omit<Bank, 'id' | 'createdAt' | 'webhookSigningKey'>>;
  }>(
    '/v1/banks/:id',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          properties: {
            name:               { type: 'string', minLength: 2 },
            logoUrl:            { type: 'string' },
            primaryColor:       { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
            customDomain:       { type: 'string' },
            webhookUrl:         { type: 'string' },
            webhookFormat:      { type: 'string', enum: ['forgepay', 'iso20022', 'custom'] },
            kycInherited:       { type: 'boolean' },
            amlLevel:           { type: 'string', enum: ['inherited', 'standard', 'enhanced'] },
            settlementCurrency: { type: 'string' },
            settlementSchedule: { type: 'string', enum: ['daily', 'weekly'] },
            adminEmails:        { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const role   = extractRole(request);
      const bankId = extractBankId(request);
      const { id } = request.params;

      // Tenant isolation
      if (role !== 'super_admin' && bankId !== id) {
        return reply.status(403).send({ error: 'Access denied — bank mismatch' });
      }

      // Viewers cannot update configuration
      if (role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot modify bank configuration' });
      }

      // Prevent slug changes (would break URLs)
      const { slug, ...safeUpdates } = request.body as any;

      const updated = Banks.update(id, safeUpdates);
      if (!updated) return reply.status(404).send({ error: 'Bank not found' });

      return reply.send(sanitizeBank(updated));
    },
  );

  // ── DELETE /v1/banks/:id — suspend bank ───────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/v1/banks/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const role = extractRole(request);
      if (role !== 'super_admin') {
        return reply.status(403).send({ error: 'Only super_admins can delete banks' });
      }

      const { id } = request.params;
      const bank = Banks.findById(id);
      if (!bank) return reply.status(404).send({ error: 'Bank not found' });

      // Soft-delete: mark as suspended rather than removing from store
      Banks.update(id, { status: 'suspended' });

      return reply.status(200).send({ message: `Bank '${id}' suspended` });
    },
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strip sensitive fields (webhookSigningKey) before sending to clients.
 * The signing key is only exposed at creation time.
 */
function sanitizeBank(bank: Bank): Omit<Bank, 'webhookSigningKey'> {
  const { webhookSigningKey: _key, ...safe } = bank;
  return safe;
}

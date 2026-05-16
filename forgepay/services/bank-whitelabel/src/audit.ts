/**
 * Audit Log Routes
 *
 * Exposes the admin action audit trail. Super-admins can view the full log;
 * regular admins can only view their own bank's entries.
 *
 * Routes:
 *   GET /v1/audit — returns audit log entries (scoped by role)
 */

import type { FastifyInstance } from 'fastify';
import { AuditLog } from './store.js';
import { authenticate, extractBankId, extractRole } from './auth.js';

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>(
    '/v1/audit',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const role   = extractRole(request);
      const bankId = extractBankId(request);
      const limit  = Math.min(parseInt(request.query.limit ?? '100', 10), 500);

      const entries = role === 'super_admin'
        ? AuditLog.findAll(limit)
        : AuditLog.findByBank(bankId, limit);

      return reply.send({ data: entries, total: entries.length });
    },
  );
}

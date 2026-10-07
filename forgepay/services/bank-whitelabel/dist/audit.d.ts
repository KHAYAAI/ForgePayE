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
export declare function registerAuditRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=audit.d.ts.map
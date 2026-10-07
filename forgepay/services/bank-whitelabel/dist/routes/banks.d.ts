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
export declare function registerBankRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=banks.d.ts.map
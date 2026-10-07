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
export declare function registerCustomerRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=customers.d.ts.map
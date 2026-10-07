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
export declare function registerTransactionRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=transactions.d.ts.map
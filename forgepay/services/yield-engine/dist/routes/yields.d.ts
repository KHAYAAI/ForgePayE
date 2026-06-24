/**
 * Yield analytics routes.
 *
 * GET /api/v1/yields/apys          — current APYs for all protocols (with cache)
 * GET /api/v1/yields/history       — yield accrual history for merchant
 * GET /api/v1/yields/transactions  — full yield transaction log
 */
import type { FastifyInstance } from 'fastify';
export declare function buildYieldRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=yields.d.ts.map
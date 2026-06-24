/**
 * Sweep routes.
 *
 * GET  /api/v1/sweep/config    — get the merchant's current sweep config
 * PUT  /api/v1/sweep/config    — create or update sweep config
 * POST /api/v1/sweep/run       — manually trigger the sweep now
 * GET  /api/v1/sweep/history   — list sweep transactions for the merchant
 */
import type { FastifyInstance } from 'fastify';
export declare function buildSweepRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=sweep.d.ts.map
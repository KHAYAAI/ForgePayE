/**
 * Position routes.
 *
 * GET    /api/v1/positions          — list merchant's active positions
 * GET    /api/v1/positions/:id      — position detail + yield history
 * POST   /api/v1/positions          — manually open a vault deposit
 * DELETE /api/v1/positions/:id      — initiate withdrawal
 * GET    /api/v1/portfolio          — aggregate portfolio summary
 */
import type { FastifyInstance } from 'fastify';
export declare function buildPositionRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=positions.d.ts.map
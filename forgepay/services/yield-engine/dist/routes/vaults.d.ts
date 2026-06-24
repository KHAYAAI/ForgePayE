/**
 * Vault routes.
 *
 * GET  /api/v1/vaults            — list all registered vaults with live APYs
 * GET  /api/v1/vaults/best       — best vault for a given asset + risk level
 * GET  /api/v1/vaults/:id        — single vault detail
 */
import type { FastifyInstance } from 'fastify';
export declare function buildVaultRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=vaults.d.ts.map
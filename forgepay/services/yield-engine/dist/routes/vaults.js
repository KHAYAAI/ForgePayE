"use strict";
/**
 * Vault routes.
 *
 * GET  /api/v1/vaults            — list all registered vaults with live APYs
 * GET  /api/v1/vaults/best       — best vault for a given asset + risk level
 * GET  /api/v1/vaults/:id        — single vault detail
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVaultRoutes = buildVaultRoutes;
const zod_1 = require("zod");
const store_1 = require("../store");
const apyAggregator_1 = require("../services/apyAggregator");
const BestQuerySchema = zod_1.z.object({
    asset: zod_1.z.enum(['USDC', 'USDT', 'DAI', 'USDY', 'USTB']),
    minApy: zod_1.z.string().optional().transform((v) => (v ? parseFloat(v) : 0)),
    riskLevel: zod_1.z.enum(['low', 'medium', 'high']).optional().default('high'),
    chain: zod_1.z.enum(['ethereum', 'polygon', 'base', 'arbitrum']).optional(),
});
async function buildVaultRoutes(app) {
    // ── List all vaults ────────────────────────────────────────────────────────
    app.get('/', async (_req, reply) => {
        // Trigger an async APY refresh in the background; return the current store
        // values immediately so the response is fast.
        (0, apyAggregator_1.fetchAllApys)().catch(() => { });
        const vaults = [...store_1.vaultsStore.values()].sort((a, b) => b.apy - a.apy);
        return reply.send({ data: vaults, total: vaults.length });
    });
    // ── Best vault ─────────────────────────────────────────────────────────────
    app.get('/best', async (req, reply) => {
        const parseResult = BestQuerySchema.safeParse(req.query);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: 'Invalid query parameters',
                details: parseResult.error.flatten(),
            });
        }
        const { asset, minApy, riskLevel, chain } = parseResult.data;
        const vault = await (0, apyAggregator_1.getBestVault)(asset, minApy, riskLevel, chain ? [chain] : undefined);
        if (!vault) {
            return reply.status(404).send({
                error: 'No vault found matching the given criteria',
            });
        }
        return reply.send(vault);
    });
    // ── Single vault ───────────────────────────────────────────────────────────
    app.get('/:id', async (req, reply) => {
        const vault = store_1.vaultsStore.get(req.params.id);
        if (!vault) {
            return reply.status(404).send({ error: 'Vault not found' });
        }
        return reply.send(vault);
    });
}
//# sourceMappingURL=vaults.js.map
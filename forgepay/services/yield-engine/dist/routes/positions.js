"use strict";
/**
 * Position routes.
 *
 * GET    /api/v1/positions          — list merchant's active positions
 * GET    /api/v1/positions/:id      — position detail + yield history
 * POST   /api/v1/positions          — manually open a vault deposit
 * DELETE /api/v1/positions/:id      — initiate withdrawal
 * GET    /api/v1/portfolio          — aggregate portfolio summary
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPositionRoutes = buildPositionRoutes;
const zod_1 = require("zod");
const uuid_1 = require("uuid");
const store_1 = require("../store");
const sweepService_1 = require("../services/sweepService");
const positionTracker_1 = require("../services/positionTracker");
// ── Validation schemas ────────────────────────────────────────────────────────
const CreatePositionSchema = zod_1.z.object({
    merchantId: zod_1.z.string().min(1),
    vaultId: zod_1.z.string().min(1),
    amountUsd: zod_1.z.number().positive(),
    walletAddress: zod_1.z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
});
const WithdrawSchema = zod_1.z.object({
    amountUsd: zod_1.z.number().positive().optional(),
}).optional();
// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * Extract merchantId from either JWT claims or the `x-merchant-id` header.
 * In production the JWT middleware populates `req.user.merchantId`.
 */
function getMerchantId(req) {
    if (req.user?.merchantId)
        return req.user.merchantId;
    const header = req.headers['x-merchant-id'];
    return typeof header === 'string' ? header : null;
}
// ── Routes ────────────────────────────────────────────────────────────────────
async function buildPositionRoutes(app) {
    // ── List positions ─────────────────────────────────────────────────────────
    app.get('/', async (req, reply) => {
        const merchantId = getMerchantId(req);
        if (!merchantId) {
            return reply.status(401).send({ error: 'Missing merchant identity' });
        }
        const positions = (0, store_1.getPositionsByMerchant)(merchantId);
        return reply.send({ data: positions, total: positions.length });
    });
    // ── Portfolio summary ──────────────────────────────────────────────────────
    app.get('/portfolio', async (req, reply) => {
        const merchantId = getMerchantId(req);
        if (!merchantId) {
            return reply.status(401).send({ error: 'Missing merchant identity' });
        }
        const summary = (0, positionTracker_1.getPortfolioSummary)(merchantId);
        return reply.send(summary);
    });
    // ── Position detail ────────────────────────────────────────────────────────
    app.get('/:id', async (req, reply) => {
        const merchantId = getMerchantId(req);
        if (!merchantId) {
            return reply.status(401).send({ error: 'Missing merchant identity' });
        }
        const position = store_1.positionsStore.get(req.params.id);
        if (!position) {
            return reply.status(404).send({ error: 'Position not found' });
        }
        if (position.merchantId !== merchantId) {
            return reply.status(403).send({ error: 'Forbidden' });
        }
        // Fetch the most recent on-chain balance
        const refreshed = await (0, positionTracker_1.refreshPosition)(req.params.id);
        // Include yield transaction history for this position
        const history = (0, store_1.getTxsByMerchant)(merchantId).filter((t) => t.positionId === req.params.id);
        return reply.send({ ...(refreshed ?? position), history });
    });
    // ── Open a manual deposit ──────────────────────────────────────────────────
    app.post('/', async (req, reply) => {
        const merchantId = getMerchantId(req);
        if (!merchantId) {
            return reply.status(401).send({ error: 'Missing merchant identity' });
        }
        const parseResult = CreatePositionSchema.safeParse(req.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: 'Validation error',
                details: parseResult.error.flatten(),
            });
        }
        const { vaultId, amountUsd, walletAddress } = parseResult.data;
        const vault = store_1.vaultsStore.get(vaultId);
        if (!vault) {
            return reply.status(404).send({ error: 'Vault not found' });
        }
        if (amountUsd < vault.minDeposit) {
            return reply.status(422).send({
                error: `Amount $${amountUsd} is below vault minimum deposit of $${vault.minDeposit}`,
            });
        }
        const now = new Date().toISOString();
        const positionId = (0, uuid_1.v4)();
        const txId = (0, uuid_1.v4)();
        const position = {
            id: positionId,
            merchantId,
            vaultId,
            principal: amountUsd,
            shares: amountUsd, // approximate; updated after on-chain confirmation
            currentValue: amountUsd,
            unrealizedYield: 0,
            realizedYield: 0,
            depositedAt: now,
            lastUpdatedAt: now,
            status: 'active',
            walletAddress,
        };
        store_1.positionsStore.set(positionId, position);
        const tx = {
            id: txId,
            merchantId,
            positionId,
            type: 'deposit',
            amount: amountUsd,
            asset: vault.asset,
            chain: vault.chain,
            status: 'pending',
            createdAt: now,
        };
        store_1.txStore.set(txId, tx);
        return reply.status(201).send({ position, transaction: tx });
    });
    // ── Initiate withdrawal ────────────────────────────────────────────────────
    app.delete('/:id', async (req, reply) => {
        const merchantId = getMerchantId(req);
        if (!merchantId) {
            return reply.status(401).send({ error: 'Missing merchant identity' });
        }
        const position = store_1.positionsStore.get(req.params.id);
        if (!position) {
            return reply.status(404).send({ error: 'Position not found' });
        }
        if (position.merchantId !== merchantId) {
            return reply.status(403).send({ error: 'Forbidden' });
        }
        let amountUsd;
        if (req.body && typeof req.body === 'object') {
            const parsed = WithdrawSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
            }
            amountUsd = parsed.data?.amountUsd;
        }
        try {
            const tx = await (0, sweepService_1.scheduleWithdrawal)(merchantId, req.params.id, amountUsd);
            return reply.send({ message: 'Withdrawal initiated', transaction: tx });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            return reply.status(422).send({ error: message });
        }
    });
}
//# sourceMappingURL=positions.js.map
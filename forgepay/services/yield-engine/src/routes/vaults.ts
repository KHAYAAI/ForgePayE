/**
 * Vault routes.
 *
 * GET  /api/v1/vaults            — list all registered vaults with live APYs
 * GET  /api/v1/vaults/best       — best vault for a given asset + risk level
 * GET  /api/v1/vaults/:id        — single vault detail
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { vaultsStore } from '../store';
import { fetchAllApys, getBestVault } from '../services/apyAggregator';

const BestQuerySchema = z.object({
  asset:     z.enum(['USDC', 'USDT', 'DAI', 'USDY', 'USTB']),
  minApy:    z.string().optional().transform((v) => (v ? parseFloat(v) : 0)),
  riskLevel: z.enum(['low', 'medium', 'high']).optional().default('high'),
  chain:     z.enum(['ethereum', 'polygon', 'base', 'arbitrum']).optional(),
});

export async function buildVaultRoutes(app: FastifyInstance): Promise<void> {
  // ── List all vaults ────────────────────────────────────────────────────────
  app.get('/', async (_req, reply) => {
    // Trigger an async APY refresh in the background; return the current store
    // values immediately so the response is fast.
    fetchAllApys().catch(() => { /* logged inside */ });

    const vaults = [...vaultsStore.values()].sort((a, b) => b.apy - a.apy);
    return reply.send({ data: vaults, total: vaults.length });
  });

  // ── Best vault ─────────────────────────────────────────────────────────────
  app.get('/best', async (req, reply) => {
    const parseResult = BestQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error:   'Invalid query parameters',
        details: parseResult.error.flatten(),
      });
    }
    const { asset, minApy, riskLevel, chain } = parseResult.data;

    const vault = await getBestVault(
      asset,
      minApy,
      riskLevel,
      chain ? [chain] : undefined,
    );

    if (!vault) {
      return reply.status(404).send({
        error: 'No vault found matching the given criteria',
      });
    }

    return reply.send(vault);
  });

  // ── Single vault ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const vault = vaultsStore.get(req.params.id);
    if (!vault) {
      return reply.status(404).send({ error: 'Vault not found' });
    }
    return reply.send(vault);
  });
}

/**
 * Sweep routes.
 *
 * GET  /api/v1/sweep/config    — get the merchant's current sweep config
 * PUT  /api/v1/sweep/config    — create or update sweep config
 * POST /api/v1/sweep/run       — manually trigger the sweep now
 * GET  /api/v1/sweep/history   — list sweep transactions for the merchant
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sweepConfigStore, vaultsStore, getSweepTxsByMerchant } from '../store';
import { sweepIdleBalances } from '../services/sweepService';
import type { SweepConfig } from '../types';

// ── Validation ────────────────────────────────────────────────────────────────

const SweepConfigSchema = z.object({
  enabled:           z.boolean(),
  idleThresholdUsd:  z.number().positive(),
  targetVaultId:     z.string().min(1),
  keepReserveUsd:    z.number().nonnegative(),
  autoCompound:      z.boolean(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMerchantId(req: {
  headers: Record<string, string | string[] | undefined>;
  user?: { merchantId?: string };
}): string | null {
  if (req.user?.merchantId) return req.user.merchantId;
  const header = req.headers['x-merchant-id'];
  return typeof header === 'string' ? header : null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function buildSweepRoutes(app: FastifyInstance): Promise<void> {
  // ── Get sweep config ───────────────────────────────────────────────────────
  app.get('/config', async (req, reply) => {
    const merchantId = getMerchantId(req as any);
    if (!merchantId) {
      return reply.status(401).send({ error: 'Missing merchant identity' });
    }

    const existing = sweepConfigStore.get(merchantId);
    if (!existing) {
      // Return a sensible default rather than 404 so the UI can render a
      // "not configured yet" state.
      return reply.send({
        merchantId,
        enabled:           false,
        idleThresholdUsd:  1000,
        targetVaultId:     null,
        keepReserveUsd:    500,
        autoCompound:      false,
        configured:        false,
      });
    }

    return reply.send({ ...existing, configured: true });
  });

  // ── Create / update sweep config ───────────────────────────────────────────
  app.put('/config', async (req, reply) => {
    const merchantId = getMerchantId(req as any);
    if (!merchantId) {
      return reply.status(401).send({ error: 'Missing merchant identity' });
    }

    const parseResult = SweepConfigSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error:   'Validation error',
        details: parseResult.error.flatten(),
      });
    }

    const body = parseResult.data;

    // Validate that the targetVaultId actually exists
    if (!vaultsStore.has(body.targetVaultId)) {
      return reply.status(422).send({
        error: `Vault not found: ${body.targetVaultId}`,
      });
    }

    const cfg: SweepConfig = { merchantId, ...body };
    sweepConfigStore.set(merchantId, cfg);

    return reply.send({ ...cfg, configured: true });
  });

  // ── Manually trigger a sweep ───────────────────────────────────────────────
  app.post('/run', async (req, reply) => {
    const merchantId = getMerchantId(req as any);
    if (!merchantId) {
      return reply.status(401).send({ error: 'Missing merchant identity' });
    }

    const cfg = sweepConfigStore.get(merchantId);
    if (!cfg) {
      return reply.status(422).send({
        error: 'No sweep config found. Set up your sweep config first via PUT /api/v1/sweep/config',
      });
    }

    // Temporarily force the config to enabled for this one-shot run, even if
    // the merchant's standing config has it disabled.
    const original = cfg.enabled;
    sweepConfigStore.set(merchantId, { ...cfg, enabled: true });

    try {
      const result = await sweepIdleBalances();
      return reply.send({
        message: 'Sweep run complete',
        ...result,
      });
    } finally {
      // Restore original enabled state
      sweepConfigStore.set(merchantId, { ...cfg, enabled: original });
    }
  });

  // ── Sweep history ──────────────────────────────────────────────────────────
  app.get('/history', async (req, reply) => {
    const merchantId = getMerchantId(req as any);
    if (!merchantId) {
      return reply.status(401).send({ error: 'Missing merchant identity' });
    }

    const query = req.query as { limit?: string; offset?: string };
    const limit  = Math.min(parseInt(query.limit  ?? '50',  10), 200);
    const offset =            parseInt(query.offset ?? '0',   10);

    const allTxs = getSweepTxsByMerchant(merchantId);
    const page   = allTxs.slice(offset, offset + limit);

    return reply.send({
      data:   page,
      total:  allTxs.length,
      limit,
      offset,
    });
  });
}

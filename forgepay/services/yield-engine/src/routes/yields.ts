/**
 * Yield analytics routes.
 *
 * GET /api/v1/yields/apys          — current APYs for all protocols (with cache)
 * GET /api/v1/yields/history       — yield accrual history for merchant
 * GET /api/v1/yields/transactions  — full yield transaction log
 */

import type { FastifyInstance } from 'fastify';
import { vaultsStore, getTxsByMerchant } from '../store';
import { fetchAllApys } from '../services/apyAggregator';
import { getMerchantId } from '../lib/auth';

// ── Routes ────────────────────────────────────────────────────────────────────
// Merchant identity is always derived from the verified JWT via
// getMerchantId() (../lib/auth.ts) — never from a client-suppliable header.

export async function buildYieldRoutes(app: FastifyInstance): Promise<void> {
  // ── Current APYs ───────────────────────────────────────────────────────────
  app.get('/apys', async (_req, reply) => {
    // fetchAllApys returns the per-protocol maximums.
    // We also return per-vault so the caller can see chain-level granularity.
    const byProtocol = await fetchAllApys();

    const vaultApys = [...vaultsStore.values()].map((v) => ({
      vaultId:     v.id,
      protocol:    v.protocol,
      name:        v.name,
      asset:       v.asset,
      chain:       v.chain,
      apy:         v.apy,
      apyPct:      +(v.apy * 100).toFixed(2),
      updatedAt:   v.apyUpdatedAt,
      riskLevel:   v.riskLevel,
      withdrawalDelay: v.withdrawalDelay,
    }));

    const protocolSummary = Object.fromEntries(
      [...byProtocol.entries()].map(([proto, apy]) => [
        proto,
        { apy, apyPct: +(apy * 100).toFixed(2) },
      ]),
    );

    return reply.send({
      byProtocol: protocolSummary,
      byVault:    vaultApys.sort((a, b) => b.apy - a.apy),
      updatedAt:  new Date().toISOString(),
    });
  });

  // ── Yield accrual history ──────────────────────────────────────────────────
  app.get('/history', async (req, reply) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return reply.status(401).send({ error: 'Missing merchant identity' });
    }

    const query = req.query as { positionId?: string; limit?: string; offset?: string };
    const limit  = Math.min(parseInt(query.limit  ?? '100', 10), 500);
    const offset =            parseInt(query.offset ?? '0',   10);

    let txs = getTxsByMerchant(merchantId).filter(
      (t) => t.type === 'yield_accrual',
    );

    if (query.positionId) {
      txs = txs.filter((t) => t.positionId === query.positionId);
    }

    const page = txs.slice(offset, offset + limit);

    // Compute total yield realised from accrual events
    const totalYield = txs.reduce((sum, t) => sum + t.amount, 0);

    return reply.send({
      data:       page,
      total:      txs.length,
      totalYield,
      limit,
      offset,
    });
  });

  // ── Full transaction log ───────────────────────────────────────────────────
  app.get('/transactions', async (req, reply) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return reply.status(401).send({ error: 'Missing merchant identity' });
    }

    const query = req.query as {
      type?:       string;
      status?:     string;
      positionId?: string;
      limit?:      string;
      offset?:     string;
    };

    const limit  = Math.min(parseInt(query.limit  ?? '50',  10), 200);
    const offset =            parseInt(query.offset ?? '0',   10);

    let txs = getTxsByMerchant(merchantId);

    if (query.type) {
      const allowedTypes = ['deposit', 'withdrawal', 'yield_accrual', 'auto_sweep'];
      if (!allowedTypes.includes(query.type)) {
        return reply.status(400).send({ error: `Invalid type filter: ${query.type}` });
      }
      txs = txs.filter((t) => t.type === query.type);
    }

    if (query.status) {
      const allowedStatuses = ['pending', 'confirmed', 'failed'];
      if (!allowedStatuses.includes(query.status)) {
        return reply.status(400).send({ error: `Invalid status filter: ${query.status}` });
      }
      txs = txs.filter((t) => t.status === query.status);
    }

    if (query.positionId) {
      txs = txs.filter((t) => t.positionId === query.positionId);
    }

    const page = txs.slice(offset, offset + limit);

    return reply.send({
      data:   page,
      total:  txs.length,
      limit,
      offset,
    });
  });
}

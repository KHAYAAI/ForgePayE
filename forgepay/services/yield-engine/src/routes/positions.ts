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
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { positionsStore, txStore, vaultsStore, getPositionsByMerchant, getTxsByMerchant } from '../store';
import { scheduleWithdrawal } from '../services/sweepService';
import { getPortfolioSummary, refreshPosition } from '../services/positionTracker';
import type { YieldPosition, YieldTransaction } from '../types';

// ── Validation schemas ────────────────────────────────────────────────────────

const CreatePositionSchema = z.object({
  merchantId:    z.string().min(1),
  vaultId:       z.string().min(1),
  amountUsd:     z.number().positive(),
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
});

const WithdrawSchema = z.object({
  amountUsd: z.number().positive().optional(),
}).optional();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract merchantId from either JWT claims or the `x-merchant-id` header.
 * In production the JWT middleware populates `req.user.merchantId`.
 */
function getMerchantId(req: {
  headers: Record<string, string | string[] | undefined>;
  user?: { merchantId?: string };
}): string | null {
  if (req.user?.merchantId) return req.user.merchantId;
  const header = req.headers['x-merchant-id'];
  return typeof header === 'string' ? header : null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function buildPositionRoutes(app: FastifyInstance): Promise<void> {
  // ── List positions ─────────────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const merchantId = getMerchantId(req as any);
    if (!merchantId) {
      return reply.status(401).send({ error: 'Missing merchant identity' });
    }

    const positions = getPositionsByMerchant(merchantId);
    return reply.send({ data: positions, total: positions.length });
  });

  // ── Portfolio summary ──────────────────────────────────────────────────────
  app.get('/portfolio', async (req, reply) => {
    const merchantId = getMerchantId(req as any);
    if (!merchantId) {
      return reply.status(401).send({ error: 'Missing merchant identity' });
    }
    const summary = getPortfolioSummary(merchantId);
    return reply.send(summary);
  });

  // ── Position detail ────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const merchantId = getMerchantId(req as any);
    if (!merchantId) {
      return reply.status(401).send({ error: 'Missing merchant identity' });
    }

    const position = positionsStore.get(req.params.id);
    if (!position) {
      return reply.status(404).send({ error: 'Position not found' });
    }
    if (position.merchantId !== merchantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    // Fetch the most recent on-chain balance
    const refreshed = await refreshPosition(req.params.id);

    // Include yield transaction history for this position
    const history = getTxsByMerchant(merchantId).filter(
      (t) => t.positionId === req.params.id,
    );

    return reply.send({ ...(refreshed ?? position), history });
  });

  // ── Open a manual deposit ──────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const merchantId = getMerchantId(req as any);
    if (!merchantId) {
      return reply.status(401).send({ error: 'Missing merchant identity' });
    }

    const parseResult = CreatePositionSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error:   'Validation error',
        details: parseResult.error.flatten(),
      });
    }

    const { vaultId, amountUsd, walletAddress } = parseResult.data;

    const vault = vaultsStore.get(vaultId);
    if (!vault) {
      return reply.status(404).send({ error: 'Vault not found' });
    }
    if (amountUsd < vault.minDeposit) {
      return reply.status(422).send({
        error: `Amount $${amountUsd} is below vault minimum deposit of $${vault.minDeposit}`,
      });
    }

    const now        = new Date().toISOString();
    const positionId = uuidv4();
    const txId       = uuidv4();

    const position: YieldPosition & { walletAddress?: string } = {
      id:              positionId,
      merchantId,
      vaultId,
      principal:       amountUsd,
      shares:          amountUsd, // approximate; updated after on-chain confirmation
      currentValue:    amountUsd,
      unrealizedYield: 0,
      realizedYield:   0,
      depositedAt:     now,
      lastUpdatedAt:   now,
      status:          'active',
      walletAddress,
    };
    positionsStore.set(positionId, position);

    const tx: YieldTransaction = {
      id:        txId,
      merchantId,
      positionId,
      type:      'deposit',
      amount:    amountUsd,
      asset:     vault.asset as any,
      chain:     vault.chain,
      status:    'pending',
      createdAt: now,
    };
    txStore.set(txId, tx);

    return reply.status(201).send({ position, transaction: tx });
  });

  // ── Initiate withdrawal ────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const merchantId = getMerchantId(req as any);
    if (!merchantId) {
      return reply.status(401).send({ error: 'Missing merchant identity' });
    }

    const position = positionsStore.get(req.params.id);
    if (!position) {
      return reply.status(404).send({ error: 'Position not found' });
    }
    if (position.merchantId !== merchantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    let amountUsd: number | undefined;
    if (req.body && typeof req.body === 'object') {
      const parsed = WithdrawSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
      }
      amountUsd = parsed.data?.amountUsd;
    }

    try {
      const tx = await scheduleWithdrawal(merchantId, req.params.id, amountUsd);
      return reply.send({ message: 'Withdrawal initiated', transaction: tx });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(422).send({ error: message });
    }
  });
}

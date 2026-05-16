/**
 * Internal settlement routes — called service-to-service by enterprise-treasury
 * and the stablecoin-gateway. Authenticated by x-source + x-internal-secret headers
 * rather than merchant JWT.
 *
 * POST /v1/transfers/wire        — intercompany wire settlement instruction
 * POST /v1/transfers/stablecoin  — USDC/USDT on-chain settlement instruction
 * GET  /v1/transfers/internal/:id — status polling by enterprise-treasury
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../lib/logger';

// ── In-memory settlement store (PostgreSQL in production) ─────────────────────

interface SettlementRecord {
  transferId:    string;
  source:        string;
  from:          string;
  to:            string;
  amountUsd:     number;
  currency:      string;
  method:        'wire' | 'stablecoin';
  reference:     string;
  invoiceRefs:   string[];
  status:        'pending' | 'submitted' | 'confirmed' | 'failed';
  createdAt:     string;
  updatedAt:     string;
  confirmedAt?:  string;
  txHash?:       string;     // on-chain tx hash for stablecoin settlements
  swiftRef?:     string;     // SWIFT/UETR reference for wire settlements
}

const settlementStore = new Map<string, SettlementRecord>();

// ── Schemas ───────────────────────────────────────────────────────────────────

const SettlementBodySchema = z.object({
  from:        z.string().min(1),
  to:          z.string().min(1),
  amountUsd:   z.number().positive().finite(),
  currency:    z.string().min(3).max(5).toUpperCase().default('USD'),
  reference:   z.string().min(1).max(140),
  invoiceRefs: z.array(z.string()).default([]),
});

// ── Internal auth middleware ───────────────────────────────────────────────────

const INTERNAL_SECRET = process.env['INTERNAL_SECRET'] ?? '';
const ALLOWED_SOURCES = new Set(['enterprise-treasury', 'institutional-reporting', 'agent-liquidity-manager']);

function verifyInternalRequest(req: FastifyRequest, reply: FastifyReply): boolean {
  const source = req.headers['x-source'] as string | undefined;
  const secret = req.headers['x-internal-secret'] as string | undefined;

  if (!source || !ALLOWED_SOURCES.has(source)) {
    reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid x-source' });
    return false;
  }

  // In production: verify HMAC of request body with shared secret.
  // Skip secret check if INTERNAL_SECRET is not configured (development).
  if (INTERNAL_SECRET && secret !== INTERNAL_SECRET) {
    reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid x-internal-secret' });
    return false;
  }

  return true;
}

function makeRecord(
  method: 'wire' | 'stablecoin',
  source: string,
  body: z.infer<typeof SettlementBodySchema>,
): SettlementRecord {
  const ts = new Date().toISOString();
  return {
    transferId:  randomUUID(),
    source,
    from:        body.from,
    to:          body.to,
    amountUsd:   body.amountUsd,
    currency:    body.currency,
    method,
    reference:   body.reference,
    invoiceRefs: body.invoiceRefs,
    status:      'submitted',
    createdAt:   ts,
    updatedAt:   ts,
    // Wire: simulate SWIFT UETR reference
    ...(method === 'wire'
      ? { swiftRef: `UETR-${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}` }
      : { txHash: `0x${Buffer.from(randomUUID()).toString('hex').slice(0, 64)}` }),
  };
}

// ── Route registration ─────────────────────────────────────────────────────────

export async function buildInternalRoutes(app: FastifyInstance): Promise<void> {

  // ── POST /v1/transfers/wire ─────────────────────────────────────────────────
  app.post('/v1/transfers/wire', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyInternalRequest(req, reply)) return;

    const parsed = SettlementBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        statusCode: 400,
        error:   'Bad Request',
        message: parsed.error.flatten(),
      });
    }

    const source = req.headers['x-source'] as string;
    const record = makeRecord('wire', source, parsed.data);
    settlementStore.set(record.transferId, record);

    logger.info(
      {
        transferId: record.transferId,
        from:       record.from,
        to:         record.to,
        amountUsd:  record.amountUsd,
        reference:  record.reference,
        swiftRef:   record.swiftRef,
      },
      '[bank-connectivity] Wire settlement submitted',
    );

    return reply.code(201).send({
      transferId: record.transferId,
      status:     record.status,
      swiftRef:   record.swiftRef,
      reference:  record.reference,
    });
  });

  // ── POST /v1/transfers/stablecoin ───────────────────────────────────────────
  app.post('/v1/transfers/stablecoin', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyInternalRequest(req, reply)) return;

    const parsed = SettlementBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        statusCode: 400,
        error:   'Bad Request',
        message: parsed.error.flatten(),
      });
    }

    const source = req.headers['x-source'] as string;
    const record = makeRecord('stablecoin', source, parsed.data);
    settlementStore.set(record.transferId, record);

    logger.info(
      {
        transferId: record.transferId,
        from:       record.from,
        to:         record.to,
        amountUsd:  record.amountUsd,
        currency:   record.currency,
        txHash:     record.txHash,
        reference:  record.reference,
      },
      '[bank-connectivity] Stablecoin settlement submitted',
    );

    return reply.code(201).send({
      transferId: record.transferId,
      status:     record.status,
      txHash:     record.txHash,
      reference:  record.reference,
    });
  });

  // ── GET /v1/transfers/internal/:id ──────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/v1/transfers/internal/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!verifyInternalRequest(req, reply)) return;

      const record = settlementStore.get(req.params.id);
      if (!record) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: `Settlement ${req.params.id} not found` });
      }

      return reply.send({ data: record });
    },
  );

  // ── GET /v1/transfers/internal ───────────────────────────────────────────────
  app.get('/v1/transfers/internal', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyInternalRequest(req, reply)) return;

    const records = Array.from(settlementStore.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);

    return reply.send({ data: records, total: settlementStore.size });
  });
}

export { settlementStore };

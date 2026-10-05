/**
 * Internal settlement routes — called service-to-service by enterprise-treasury
 * and the stablecoin-gateway. Authenticated by x-source + x-internal-secret headers
 * rather than merchant JWT.
 *
 * No payment rail is connected. A settlement request is recorded as an
 * instruction, `awaiting_execution`, for an operator to carry out at the bank
 * or on-chain; the operator then records the real reference with
 * POST /v1/transfers/internal/:id/executed. This used to answer `submitted`
 * with a made-up SWIFT UETR or transaction hash while sending nothing, so
 * treasury believed money had moved.
 *
 * POST /v1/transfers/wire                    — record a wire instruction
 * POST /v1/transfers/stablecoin              — record a USDC/USDT instruction
 * GET  /v1/transfers/internal/:id            — status polling by enterprise-treasury
 * GET  /v1/transfers/internal                — recent instructions
 * POST /v1/transfers/internal/:id/executed   — operator records the real reference
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { logger } from '../lib/logger';

export interface SettlementRecord {
  transferId:    string;
  source:        string;
  from:          string;
  to:            string;
  amountUsd:     number;
  currency:      string;
  method:        'wire' | 'stablecoin';
  reference:     string;
  invoiceRefs:   string[];
  status:        'awaiting_execution' | 'executed' | 'failed';
  createdAt:     string;
  updatedAt:     string;
  /** The real bank reference (UETR) or transaction hash, once executed. */
  externalRef?:  string;
  executedBy?:   string;
  executedAt?:   string;
}

/** Where instructions are kept. PostgreSQL in any real deployment. */
export interface SettlementStore {
  insert(r: SettlementRecord): Promise<void>;
  get(id: string): Promise<SettlementRecord | undefined>;
  recent(limit: number): Promise<{ data: SettlementRecord[]; total: number }>;
  markExecuted(id: string, externalRef: string, executedBy: string): Promise<SettlementRecord | undefined>;
}

/** Development and tests only: lost on restart. */
export class MemorySettlementStore implements SettlementStore {
  readonly records = new Map<string, SettlementRecord>();
  async insert(r: SettlementRecord) { this.records.set(r.transferId, r); }
  async get(id: string) { return this.records.get(id); }
  async recent(limit: number) {
    const all = Array.from(this.records.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { data: all.slice(0, limit), total: all.length };
  }
  async markExecuted(id: string, externalRef: string, executedBy: string) {
    const r = this.records.get(id);
    if (!r || r.status !== 'awaiting_execution') return undefined;
    const now = new Date().toISOString();
    Object.assign(r, { status: 'executed', externalRef, executedBy, executedAt: now, updatedAt: now });
    return r;
  }
  clear() { this.records.clear(); }
}

type InternalTransferRow = {
  id: string; source: string; fromAccount: string; toAccount: string; amountCents: bigint; currency: string;
  reference: string | null; status: string; externalRef: string | null; method: string | null; invoiceRefs: unknown;
  executedBy: string | null; executedAt: Date | null; createdAt: Date; updatedAt: Date;
};

function fromRow(row: InternalTransferRow): SettlementRecord {
  return {
    transferId: row.id, source: row.source, from: row.fromAccount, to: row.toAccount,
    amountUsd: Number(row.amountCents) / 100, currency: row.currency,
    method: (row.method ?? 'wire') as SettlementRecord['method'], reference: row.reference ?? '',
    invoiceRefs: Array.isArray(row.invoiceRefs) ? (row.invoiceRefs as string[]) : [],
    status: row.status as SettlementRecord['status'],
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    ...(row.externalRef ? { externalRef: row.externalRef } : {}),
    ...(row.executedBy ? { executedBy: row.executedBy } : {}),
    ...(row.executedAt ? { executedAt: row.executedAt.toISOString() } : {}),
  };
}

/** The InternalTransfer table (prisma/schema.prisma). */
export class PrismaSettlementStore implements SettlementStore {
  constructor(private readonly prisma: PrismaClient) {}
  async insert(r: SettlementRecord) {
    await this.prisma.internalTransfer.create({
      data: {
        id: r.transferId, source: r.source, fromAccount: r.from, toAccount: r.to,
        amountCents: BigInt(Math.round(r.amountUsd * 100)), currency: r.currency, reference: r.reference,
        status: r.status, method: r.method, invoiceRefs: r.invoiceRefs,
      },
    });
  }
  async get(id: string) {
    const row = await this.prisma.internalTransfer.findUnique({ where: { id } });
    return row ? fromRow(row as InternalTransferRow) : undefined;
  }
  async recent(limit: number) {
    const [rows, total] = await Promise.all([
      this.prisma.internalTransfer.findMany({ where: { method: { not: null } }, orderBy: { createdAt: 'desc' }, take: limit }),
      this.prisma.internalTransfer.count({ where: { method: { not: null } } }),
    ]);
    return { data: rows.map((r) => fromRow(r as InternalTransferRow)), total };
  }
  async markExecuted(id: string, externalRef: string, executedBy: string) {
    // Conditional on the current status, so one instruction cannot be marked
    // executed twice with two different references.
    const n = await this.prisma.internalTransfer.updateMany({
      where: { id, status: 'awaiting_execution' },
      data: { status: 'executed', externalRef, executedBy, executedAt: new Date() },
    });
    return n.count === 1 ? this.get(id) : undefined;
  }
}

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
const ALLOWED_SOURCES = new Set(['enterprise-treasury', 'institutional-reporting', 'agent-liquidity-manager', 'mor-layer', 'operations-console']);

// SECURITY: settlement routes must never run without a shared secret in production.
if (!INTERNAL_SECRET && process.env['NODE_ENV'] === 'production') {
  throw new Error('[bank-connectivity] INTERNAL_SECRET env var is required in production (internal settlement routes)');
}

/** Timing-safe string comparison — prevents byte-by-byte secret recovery. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function verifyInternalRequest(req: FastifyRequest, reply: FastifyReply): boolean {
  const source = req.headers['x-source'] as string | undefined;
  const secret = req.headers['x-internal-secret'] as string | undefined;

  if (!source || !ALLOWED_SOURCES.has(source)) {
    reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid x-source' });
    return false;
  }

  // Secret check may only be skipped in local development when unset.
  if (INTERNAL_SECRET && (!secret || !safeEqual(secret, INTERNAL_SECRET))) {
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
    status:      'awaiting_execution',
    createdAt:   ts,
    updatedAt:   ts,
  };
}

const ExecutedBodySchema = z.object({
  externalRef: z.string().min(4).max(200),
  executedBy:  z.string().min(1).max(200),
});

const NOT_EXECUTED_NOTE =
  'Recorded for manual execution. No payment rail is connected, so nothing has been sent; ' +
  'an operator executes this at the bank or on-chain and records the reference.';

// ── Route registration ─────────────────────────────────────────────────────────

export const virtualAccounts = new Map<string, Record<string, unknown>>();

export async function buildInternalRoutes(
  app: FastifyInstance,
  opts: { store?: SettlementStore } = {},
): Promise<void> {
  const store = opts.store ?? defaultStore();

  async function record(method: 'wire' | 'stablecoin', req: FastifyRequest, reply: FastifyReply) {
    if (!verifyInternalRequest(req, reply)) return;

    const parsed = SettlementBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: parsed.error.flatten() });
    }

    const r = makeRecord(method, req.headers['x-source'] as string, parsed.data);
    await store.insert(r);
    logger.info(
      { transferId: r.transferId, method, from: r.from, to: r.to, amountUsd: r.amountUsd, reference: r.reference },
      '[bank-connectivity] Settlement instruction recorded (awaiting manual execution)',
    );

    // 202: accepted for processing, not done.
    return reply.code(202).send({
      transferId: r.transferId,
      status:     r.status,
      executed:   false,
      reference:  r.reference,
      note:       NOT_EXECUTED_NOTE,
    });
  }

  app.post('/v1/transfers/wire', (req, reply) => record('wire', req, reply));
  app.post('/v1/transfers/stablecoin', (req, reply) => record('stablecoin', req, reply));

  app.get<{ Params: { id: string } }>('/v1/transfers/internal/:id', async (req, reply) => {
    if (!verifyInternalRequest(req, reply)) return;
    const r = await store.get(req.params.id);
    if (!r) return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: `Settlement ${req.params.id} not found` });
    return reply.send({ data: r });
  });

  app.get('/v1/transfers/internal', async (req, reply) => {
    if (!verifyInternalRequest(req, reply)) return;
    return reply.send(await store.recent(100));
  });

  // An operator has executed the instruction outside FORGE and records the
  // real reference. Only from the operations console.
  app.post<{ Params: { id: string } }>('/v1/transfers/internal/:id/executed', async (req, reply) => {
    if (!verifyInternalRequest(req, reply)) return;
    if (req.headers['x-source'] !== 'operations-console') {
      return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only the operations console records executions' });
    }
    const parsed = ExecutedBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: parsed.error.flatten() });
    }
    const r = await store.markExecuted(req.params.id, parsed.data.externalRef, parsed.data.executedBy);
    if (!r) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Not found, or not awaiting execution' });
    return reply.send({ data: r });
  });

  // ── Virtual accounts — internal callers only (these skipped auth entirely) ──
  app.get<{ Params: { id: string } }>(
    '/v1/transfers/internal/accounts/:id',
    { config: { skipAuth: true } },
    async (request, reply) => {
      if (!verifyInternalRequest(request, reply)) return;
      const account = virtualAccounts.get(request.params.id);
      if (!account) return reply.status(404).send({ error: 'Account not found' });
      return reply.send({ data: account });
    },
  );

  app.post(
    '/v1/transfers/internal/accounts',
    { config: { skipAuth: true } },
    async (request, reply) => {
      if (!verifyInternalRequest(request, reply)) return;
      const body = request.body as {
        id: string; accountName: string; accountType: string; currency: string; description?: string;
      };
      virtualAccounts.set(body.id, { ...body, createdAt: new Date().toISOString() });
      return reply.status(201).send({ data: virtualAccounts.get(body.id) });
    },
  );
}

function defaultStore(): SettlementStore {
  if (process.env['DATABASE_URL']) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
    return new PrismaSettlementStore(new PrismaClient());
  }
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('[bank-connectivity] settlement instructions need a database (DATABASE_URL) in production');
  }
  logger.warn('[bank-connectivity] No DATABASE_URL: settlement instructions are kept in memory (development only)');
  return new MemorySettlementStore();
}

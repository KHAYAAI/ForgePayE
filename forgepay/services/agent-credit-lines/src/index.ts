/**
 * ForgePay Agent Credit Lines
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Issues credit lines to AI agents with net-30/60/90 payment terms,
 *       auto-settles repayments, and tracks defaults. Pulls agent reputation
 *       from agent-identity to gate approvals.
 *
 * Features:
 *   1. Credit Assessment            — reputation-driven tiered approval
 *   2. Revolving Credit Lines       — issue / suspend / close
 *   3. Draws with Simple Interest   — amount × (1 + rate × days/365)
 *   4. Partial Repayments           — replenish credit on full settlement
 *   5. Overdue & Default Detection  — sweep every 60s
 *   6. Forge Agent Tools            — machine-readable summary endpoint
 *
 * Port: 3016
 *
 * Background jobs:
 *   Every 60 seconds — overdue/default sweep
 *
 * Env vars:
 *   AGENT_IDENTITY_URL   — default http://localhost:3010
 *   CORS_ORIGIN          — default *
 *   RATE_LIMIT_PER_MIN   — default 100
 *   LOG_LEVEL            — default info
 */

import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { z } from 'zod';

import { assessAgent } from './assessor';
import { createDraw, repayDraw, checkOverdueAndDefault, DrawError } from './draws';
import {
  putCreditLine,
  getCreditLine,
  listCreditLines,
  listCreditLinesByAgent,
  listDraws,
  getDraw,
  listDrawsByLine,
  listDefaults,
  initStoreFromDb,
} from './store';
import { runMigrations } from './db';
import type { CreditLine, CreditTerms } from './types';

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT                        = parseInt(process.env['PORT'] ?? '3016', 10);
const RATE_LIMIT_PER_MIN          = parseInt(process.env['RATE_LIMIT_PER_MIN'] ?? '100', 10);
const OVERDUE_SWEEP_INTERVAL_MS   = 60_000;

const round2 = (n: number): number => Math.round(n * 100) / 100;

let lineCounter = 0;
const nextLineId = (): string => `cl_${Date.now().toString(36)}_${(++lineCounter).toString(36)}`;

// ── Zod schemas ───────────────────────────────────────────────────────────────

const AssessSchema = z.object({
  agentId: z.string().min(1),
});

const IssueCreditLineSchema = z.object({
  agentId:         z.string().min(1),
  limitUsd:        z.number().positive(),
  termsDays:       z.union([z.literal(30), z.literal(60), z.literal(90)]),
  interestRateBps: z.number().int().min(0).max(10_000),
});

const DrawSchema = z.object({
  amountUsd:           z.number().positive(),
  purpose:             z.string().min(1),
  counterpartyAgentId: z.string().optional(),
});

const RepaySchema = z.object({
  amountUsd: z.number().positive(),
});

// ── App builder ───────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({
    logger:     { level: process.env['LOG_LEVEL'] ?? 'info' },
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin:      process.env['CORS_ORIGIN'] ?? '*',
    methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false,
  });

  await app.register(rateLimit, {
    max:        RATE_LIMIT_PER_MIN,
    timeWindow: '1 minute',
    keyGenerator: (req) =>
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error:      'Too Many Requests',
      message:    `Rate limit exceeded. Retry in ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status:    'ok',
    service:   'agent-credit-lines',
    version:   '0.1.0',
    port:      PORT,
    timestamp: new Date().toISOString(),
  }));

  // ── Credit assessment ──────────────────────────────────────────────────────

  app.post('/v1/credit-lines/assess', async (req, reply) => {
    const parse = AssessSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const assessment = await assessAgent(parse.data.agentId);
    return reply.send({ data: assessment });
  });

  // ── Credit line CRUD ───────────────────────────────────────────────────────

  app.post('/v1/credit-lines', async (req, reply) => {
    const parse = IssueCreditLineSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const { agentId, limitUsd, termsDays, interestRateBps } = parse.data;
    const line: CreditLine = {
      id:              nextLineId(),
      agentId,
      limitUsd:        round2(limitUsd),
      availableUsd:    round2(limitUsd),
      usedUsd:         0,
      termsDays:       termsDays as CreditTerms,
      interestRateBps,
      status:          'active',
      createdAt:       new Date().toISOString(),
    };
    putCreditLine(line);
    return reply.status(201).send({ data: line });
  });

  app.get('/v1/credit-lines', async (_req, reply) => {
    const all = listCreditLines();
    return reply.send({ data: all, total: all.length });
  });

  app.get<{ Params: { id: string } }>('/v1/credit-lines/:id', async (req, reply) => {
    const line = getCreditLine(req.params.id);
    if (!line) return reply.status(404).send({ error: 'NotFound', message: `Credit line ${req.params.id} not found` });
    const draws = listDrawsByLine(line.id);
    return reply.send({ data: line, draws, drawCount: draws.length });
  });

  app.get<{ Params: { agentId: string } }>('/v1/agents/:agentId/credit-lines', async (req, reply) => {
    const lines = listCreditLinesByAgent(req.params.agentId);
    return reply.send({ data: lines, total: lines.length });
  });

  app.post<{ Params: { id: string } }>('/v1/credit-lines/:id/suspend', async (req, reply) => {
    const line = getCreditLine(req.params.id);
    if (!line) return reply.status(404).send({ error: 'NotFound' });
    if (line.status === 'closed') {
      return reply.status(409).send({ error: 'Conflict', message: 'Cannot suspend a closed credit line' });
    }
    const updated = putCreditLine({ ...line, status: 'suspended' });
    return reply.send({ data: updated });
  });

  app.post<{ Params: { id: string } }>('/v1/credit-lines/:id/close', async (req, reply) => {
    const line = getCreditLine(req.params.id);
    if (!line) return reply.status(404).send({ error: 'NotFound' });
    const outstanding = listDrawsByLine(line.id).filter((d) => d.status === 'outstanding' || d.status === 'overdue');
    if (outstanding.length > 0) {
      return reply.status(409).send({
        error:                'Conflict',
        message:              'Cannot close credit line with outstanding draws',
        outstandingDrawCount: outstanding.length,
      });
    }
    const updated = putCreditLine({ ...line, status: 'closed', availableUsd: 0 });
    return reply.send({ data: updated });
  });

  // ── Draws ──────────────────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/v1/credit-lines/:id/draws', async (req, reply) => {
    const parse = DrawSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    try {
      const draw = createDraw({
        creditLineId: req.params.id,
        amountUsd:    parse.data.amountUsd,
        purpose:      parse.data.purpose,
        ...(parse.data.counterpartyAgentId ? { counterpartyAgentId: parse.data.counterpartyAgentId } : {}),
      });
      return reply.status(201).send({ data: draw });
    } catch (err) {
      if (err instanceof DrawError) {
        const status = err.code === 'line_not_found' ? 404 : 409;
        return reply.status(status).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.get<{ Querystring: { agentId?: string; status?: string; limit?: string } }>(
    '/v1/draws',
    async (req, reply) => {
      const { agentId, status } = req.query;
      const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 500);
      let draws = listDraws();
      if (agentId) draws = draws.filter((d) => d.agentId === agentId);
      if (status)  draws = draws.filter((d) => d.status === status);
      return reply.send({ data: draws.slice(0, limit), total: draws.length });
    },
  );

  app.get<{ Params: { id: string } }>('/v1/draws/:id', async (req, reply) => {
    const draw = getDraw(req.params.id);
    if (!draw) return reply.status(404).send({ error: 'NotFound', message: `Draw ${req.params.id} not found` });
    return reply.send({ data: draw });
  });

  app.post<{ Params: { id: string } }>('/v1/draws/:id/repay', async (req, reply) => {
    const parse = RepaySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    try {
      const result = repayDraw(req.params.id, parse.data.amountUsd);
      return reply.send({ data: result });
    } catch (err) {
      if (err instanceof DrawError) {
        const status = err.code === 'draw_not_found' ? 404 : 409;
        return reply.status(status).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.post('/v1/draws/check-overdue', async (_req, reply) => {
    const result = await checkOverdueAndDefault();
    return reply.send({ data: result, timestamp: new Date().toISOString() });
  });

  // ── Agent summary ──────────────────────────────────────────────────────────

  app.get('/v1/agent/summary', async (_req, reply) => {
    const lines    = listCreditLines();
    const draws    = listDraws();
    const defaults = listDefaults();

    const totalIssued      = round2(lines.reduce((sum, l) => sum + l.limitUsd, 0));
    const totalOutstanding = round2(
      draws
        .filter((d) => d.status === 'outstanding' || d.status === 'overdue')
        .reduce((sum, d) => sum + (d.totalOwedUsd - d.repaidUsd), 0),
    );
    const totalOverdue = round2(
      draws
        .filter((d) => d.status === 'overdue')
        .reduce((sum, d) => sum + (d.totalOwedUsd - d.repaidUsd), 0),
    );
    const totalDrawCount   = draws.length;
    const defaultedCount   = defaults.length;
    const defaultRate      = totalDrawCount > 0
      ? round2((defaultedCount / totalDrawCount) * 100) / 100
      : 0;
    const totalLossUsd     = round2(defaults.reduce((sum, d) => sum + d.lossUsd, 0));

    return reply.send({
      creditLines: {
        total:     lines.length,
        active:    lines.filter((l) => l.status === 'active').length,
        suspended: lines.filter((l) => l.status === 'suspended').length,
        closed:    lines.filter((l) => l.status === 'closed').length,
      },
      draws: {
        total:       totalDrawCount,
        outstanding: draws.filter((d) => d.status === 'outstanding').length,
        overdue:     draws.filter((d) => d.status === 'overdue').length,
        repaid:      draws.filter((d) => d.status === 'repaid').length,
        defaulted:   defaultedCount,
      },
      totals: {
        totalIssuedUsd:      totalIssued,
        totalOutstandingUsd: totalOutstanding,
        totalOverdueUsd:     totalOverdue,
        totalLossUsd,
        defaultRate,
      },
      timestamp: new Date().toISOString(),
    });
  });

  // ── Error handlers ─────────────────────────────────────────────────────────
  app.setErrorHandler<FastifyError>((err, req, reply) => {
    req.log.error({ err, url: req.url }, 'Unhandled request error');
    const isDev = process.env['NODE_ENV'] !== 'production';
    reply.status(err.statusCode ?? 500).send({
      error:   err.name ?? 'InternalServerError',
      message: err.message,
      ...(isDev && err.stack ? { stack: err.stack } : {}),
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: 'NotFound', path: req.url });
  });

  return app;
}

// ── Background scheduler ──────────────────────────────────────────────────────

function startScheduler(app: Awaited<ReturnType<typeof buildApp>>): void {
  const sweepInterval = setInterval(async () => {
    try {
      const result = await checkOverdueAndDefault();
      if (result.defaulted > 0) {
        app.log.error(
          { defaulted: result.defaulted, drawIds: result.defaultedDrawIds },
          '[credit-lines] DEFAULTS DETECTED — penalty webhooks dispatched',
        );
      }
      if (result.overdue > 0) {
        app.log.warn({ overdue: result.overdue }, '[credit-lines] Draws moved to overdue');
      }
    } catch (err) {
      app.log.error({ err }, '[credit-lines] Overdue sweep error');
    }
  }, OVERDUE_SWEEP_INTERVAL_MS);

  const cleanup = (): void => {
    clearInterval(sweepInterval);
  };
  process.once('SIGTERM', cleanup);
  process.once('SIGINT',  cleanup);

  app.log.info('[credit-lines] Scheduler started — overdue sweep every 60s');
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (): Promise<void> => {
    app.log.info('[credit-lines] Shutting down...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  // DB migrations + data load (best-effort)
  try {
    await runMigrations();
    await initStoreFromDb();
    app.log.info('[credit-lines] DB migrations and store load complete');
  } catch (err) {
    app.log.warn({ err }, '[credit-lines] DB init failed — running in-memory only');
  }

  startScheduler(app);

  await app.listen({ port: PORT, host: '0.0.0.0' });

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          ForgePay Agent Credit Lines v0.1.0                  ║
║          Listening on port ${PORT}                              ║
║                                                              ║
║  Assess Agent    →  POST /v1/credit-lines/assess             ║
║  Issue Line      →  POST /v1/credit-lines                    ║
║  Draw            →  POST /v1/credit-lines/:id/draws          ║
║  Repay           →  POST /v1/draws/:id/repay                 ║
║  Sweep Overdue   →  POST /v1/draws/check-overdue             ║
║  Agent Summary   →  GET  /v1/agent/summary                   ║
╚══════════════════════════════════════════════════════════════╝
`);
}

main().catch((err) => {
  console.error('[agent-credit-lines] Fatal startup error:', err);
  process.exit(1);
});

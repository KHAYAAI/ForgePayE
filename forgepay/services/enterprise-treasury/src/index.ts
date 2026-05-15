/**
 * ForgePay Enterprise Treasury Module
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Unified treasury operations for Fortune 500 enterprises with 50-300
 *       bank accounts across multiple subsidiaries.
 *
 * Features:
 *   1. Multi-Account Cash Consolidation  — real-time position across all accounts
 *   2. Treasury Rules Engine             — auto-execute sweeps, escrow, alerts
 *   3. Intercompany Netting Engine       — minimize wire fees with net settlement
 *
 * Port: 3012
 *
 * Background jobs:
 *   Every 60 seconds  — rules evaluation cycle
 *   Every 15 minutes  — bank account balance refresh
 *
 * Upstream dependencies:
 *   bank-connectivity service (port 3006) — account balance polling
 *   yield-engine service (port 3007)      — sweep execution (future)
 *
 * Routes:
 *   GET  /health
 *   GET  /v1/cash-position
 *   POST /v1/refresh
 *   GET  /v1/rules
 *   POST /v1/rules
 *   PUT  /v1/rules/:id
 *   DELETE /v1/rules/:id
 *   POST /v1/rules/evaluate
 *   GET  /v1/rules/execution-log
 *   GET  /v1/netting/flows
 *   POST /v1/netting/flows
 *   GET  /v1/netting/calculate
 *   POST /v1/netting/settle
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';

import {
  refreshAccountBalances,
  consolidateCashPosition,
  getAccounts,
  getLastRefreshAttempt,
} from './consolidator';
import {
  listRules,
  addRule,
  updateRule,
  deleteRule,
  evaluateRules,
  getExecutionLog,
} from './rules-engine';
import {
  addFlow,
  listFlows,
  calculateNetting,
  clearSettledFlows,
  getNettingSummary,
} from './netting';
import type { CashPosition, TreasuryRule, NettingFlow } from './types';

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT                  = parseInt(process.env['PORT'] ?? '3012', 10);
const BANK_CONNECTIVITY_URL = process.env['BANK_CONNECTIVITY_URL'] ?? 'http://localhost:3006';
const RATE_LIMIT_PER_MIN    = parseInt(process.env['RATE_LIMIT_PER_MIN'] ?? '100', 10);
const RULES_EVAL_INTERVAL_MS  = 60_000;   // 60 seconds
const BALANCE_REFRESH_INTERVAL_MS = 15 * 60_000; // 15 minutes

// ── Zod schemas ───────────────────────────────────────────────────────────────

const TreasuryRuleCreateSchema = z.object({
  id:   z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  condition: z.object({
    type:         z.enum(['balance_above', 'balance_below', 'upcoming_payment', 'yield_earned_above', 'runway_below_days', 'scheduled']),
    subsidiary:   z.string().optional(),
    currency:     z.string().optional(),
    threshold:    z.number().optional(),
    daysAhead:    z.number().int().positive().optional(),
    cronSchedule: z.string().optional(),
  }),
  action: z.object({
    type:             z.enum(['sweep_to_yield', 'repatriate_from_yield', 'allocate_tax_escrow', 'send_intercompany', 'notify_cfo', 'require_approval']),
    targetVault:      z.enum(['aave', 'compound', 'ondo']).optional(),
    minApy:           z.number().optional(),
    keepLiquidUsd:    z.number().optional(),
    taxEscrowPercent: z.number().min(0).max(1).optional(),
    notifyEmails:     z.array(z.string().email()).optional(),
  }),
  approvalRequired: z.boolean().default(false),
  lastTriggered:    z.string().optional(),
});

const TreasuryRuleUpdateSchema = TreasuryRuleCreateSchema.partial().omit({ id: true });

const NettingFlowSchema = z.object({
  fromSubsidiary: z.string().min(1),
  toSubsidiary:   z.string().min(1),
  amount:         z.number().positive(),
  currency:       z.string().default('USD'),
  invoiceRef:     z.string().optional(),
  dueDate:        z.string().min(1),
});

// ── App builder ───────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    trustProxy: true,
  });

  // ── Plugins ────────────────────────────────────────────────────────────────
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

  // ── Health probe ───────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status:      'ok',
    service:     'enterprise-treasury',
    version:     '0.1.0',
    port:        PORT,
    lastRefresh: getLastRefreshAttempt(),
    timestamp:   new Date().toISOString(),
  }));

  // ── Cash position routes ───────────────────────────────────────────────────

  /**
   * GET /v1/cash-position
   * Returns the current consolidated cash position from the in-memory cache.
   * Use POST /v1/refresh to force a re-poll of bank-connectivity.
   */
  app.get('/v1/cash-position', async (_req, reply) => {
    const accounts = getAccounts();
    const position: CashPosition = consolidateCashPosition(accounts);
    return reply.send({ data: position });
  });

  /**
   * POST /v1/refresh
   * Forces an immediate re-poll of all bank accounts via bank-connectivity,
   * then returns the updated consolidated cash position.
   */
  app.post('/v1/refresh', async (_req, reply) => {
    try {
      const accounts = await refreshAccountBalances(BANK_CONNECTIVITY_URL);
      const position = consolidateCashPosition(accounts);
      return reply.send({
        data:         position,
        accountCount: accounts.length,
        refreshedAt:  new Date().toISOString(),
      });
    } catch (err) {
      app.log.error({ err }, 'Balance refresh failed');
      return reply.status(502).send({
        error:   'RefreshFailed',
        message: 'Could not reach bank-connectivity service',
      });
    }
  });

  // ── Treasury rules routes ──────────────────────────────────────────────────

  /**
   * GET /v1/rules
   * Returns all treasury rules (enabled and disabled).
   */
  app.get('/v1/rules', async (_req, reply) => {
    return reply.send({ data: listRules(), total: listRules().length });
  });

  /**
   * POST /v1/rules
   * Creates a new treasury rule.
   */
  app.post('/v1/rules', async (req, reply) => {
    const parse = TreasuryRuleCreateSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const rule = addRule(parse.data as Omit<TreasuryRule, 'executionCount'>);
    return reply.status(201).send({ data: rule });
  });

  /**
   * PUT /v1/rules/:id
   * Updates an existing treasury rule by ID.
   */
  app.put<{ Params: { id: string } }>('/v1/rules/:id', async (req, reply) => {
    const parse = TreasuryRuleUpdateSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const updated = updateRule(req.params.id, parse.data as Partial<TreasuryRule>);
    if (!updated) {
      return reply.status(404).send({ error: 'NotFound', message: `Rule ${req.params.id} not found` });
    }
    return reply.send({ data: updated });
  });

  /**
   * DELETE /v1/rules/:id
   * Removes a treasury rule by ID.
   */
  app.delete<{ Params: { id: string } }>('/v1/rules/:id', async (req, reply) => {
    const deleted = deleteRule(req.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'NotFound', message: `Rule ${req.params.id} not found` });
    }
    return reply.status(204).send();
  });

  /**
   * POST /v1/rules/evaluate
   * Manually triggers a rule evaluation cycle against the current cash position.
   * Useful for testing rules or forcing immediate execution.
   */
  app.post('/v1/rules/evaluate', async (_req, reply) => {
    const accounts  = getAccounts();
    const position  = consolidateCashPosition(accounts);
    const results   = await evaluateRules(position);
    return reply.send({
      data:      results,
      evaluated: results.length,
      executed:  results.filter(r => r.result === 'executed').length,
      skipped:   results.filter(r => r.result === 'skipped').length,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /v1/rules/execution-log
   * Returns recent rule execution history (last N entries).
   */
  app.get<{ Querystring: { limit?: string } }>('/v1/rules/execution-log', async (req, reply) => {
    const limit = parseInt((req.query as { limit?: string }).limit ?? '50', 10);
    return reply.send({ data: getExecutionLog(Math.min(limit, 200)) });
  });

  // ── Intercompany netting routes ────────────────────────────────────────────

  /**
   * GET /v1/netting/flows
   * Lists all pending intercompany payment flows.
   */
  app.get('/v1/netting/flows', async (_req, reply) => {
    const flows = listFlows();
    return reply.send({ data: flows, total: flows.length });
  });

  /**
   * POST /v1/netting/flows
   * Registers a new intercompany payment flow for netting consideration.
   */
  app.post('/v1/netting/flows', async (req, reply) => {
    const parse = NettingFlowSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const flow: NettingFlow = parse.data;
    addFlow(flow);
    return reply.status(201).send({ data: flow });
  });

  /**
   * GET /v1/netting/calculate
   * Runs the netting algorithm and returns net settlement obligations per pair,
   * plus aggregate statistics (gross vs net, fees saved, reduction %).
   */
  app.get('/v1/netting/calculate', async (_req, reply) => {
    const results = calculateNetting();
    const summary = getNettingSummary();
    return reply.send({
      data:    results,
      summary,
      total:   results.length,
    });
  });

  /**
   * POST /v1/netting/settle
   * Marks all current flows as settled and clears the netting queue.
   * In production: this would generate settlement instructions and route
   * them via bank-connectivity before clearing.
   */
  app.post('/v1/netting/settle', async (_req, reply) => {
    const summary    = getNettingSummary();
    const flowCount  = listFlows().length;
    clearSettledFlows();
    return reply.send({
      message:     'All intercompany flows marked as settled',
      settled:     flowCount,
      summary,
      settledAt:   new Date().toISOString(),
    });
  });

  // ── Error handlers ─────────────────────────────────────────────────────────
  app.setErrorHandler((err, req, reply) => {
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
  // Rules evaluation — every 60 seconds
  const rulesInterval = setInterval(async () => {
    try {
      const accounts = getAccounts();
      if (accounts.length === 0) return; // No accounts loaded yet, skip

      const position = consolidateCashPosition(accounts);
      const results  = await evaluateRules(position);
      const executed = results.filter(r => r.result === 'executed').length;
      if (executed > 0) {
        app.log.info({ executed, total: results.length }, '[treasury] Rules cycle: executed actions');
      }
    } catch (err) {
      app.log.error({ err }, '[treasury] Rules evaluation cycle error');
    }
  }, RULES_EVAL_INTERVAL_MS);

  // Account balance refresh — every 15 minutes
  const refreshInterval = setInterval(async () => {
    try {
      const accounts = await refreshAccountBalances(BANK_CONNECTIVITY_URL);
      app.log.info({ count: accounts.length }, '[treasury] Account balances refreshed');
    } catch (err) {
      app.log.warn({ err }, '[treasury] Scheduled balance refresh failed');
    }
  }, BALANCE_REFRESH_INTERVAL_MS);

  // Clean up on shutdown
  process.once('SIGTERM', () => { clearInterval(rulesInterval); clearInterval(refreshInterval); });
  process.once('SIGINT',  () => { clearInterval(rulesInterval); clearInterval(refreshInterval); });

  app.log.info('[treasury] Scheduler started — rules every 60s, balance refresh every 15m');
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async () => {
    app.log.info('[treasury] Shutting down...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  // Pre-warm: attempt initial balance load (non-blocking — service may not be up yet)
  refreshAccountBalances(BANK_CONNECTIVITY_URL)
    .then(accounts => app.log.info({ count: accounts.length }, '[treasury] Initial account load complete'))
    .catch(err => app.log.warn({ err }, '[treasury] Initial account load failed — will retry on next refresh cycle'));

  startScheduler(app);

  await app.listen({ port: PORT, host: '0.0.0.0' });

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          ForgePay Enterprise Treasury Module                 ║
║          Listening on port ${PORT}                              ║
║                                                              ║
║  Cash Consolidation  →  GET  /v1/cash-position               ║
║  Force Refresh       →  POST /v1/refresh                     ║
║  Treasury Rules      →  GET  /v1/rules                       ║
║  Run Rules Cycle     →  POST /v1/rules/evaluate              ║
║  Netting Calc        →  GET  /v1/netting/calculate           ║
╚══════════════════════════════════════════════════════════════╝
`);
}

main().catch((err) => {
  console.error('[enterprise-treasury] Fatal startup error:', err);
  process.exit(1);
});

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
 *   4. FX Rate Cache                     — hourly refresh, static fallback
 *   5. Approval Workflow                 — queue rules requiring CFO sign-off
 *   6. Forge Agent Tools                 — AI-accessible treasury operations
 *
 * Port: 3012
 *
 * Background jobs:
 *   Every 60 seconds  — rules evaluation cycle
 *   Every 15 minutes  — bank account balance refresh
 *   Every 60 minutes  — FX rate refresh
 *
 * Env vars:
 *   BANK_CONNECTIVITY_URL  — default http://localhost:3006
 *   YIELD_ENGINE_URL       — default http://localhost:3007
 *   FX_RATES_URL           — optional; ECB or Open Exchange Rates endpoint
 *   ALERT_WEBHOOK_URL      — optional; Slack/PagerDuty for CFO alerts
 *   CORS_ORIGIN            — default *
 *   RATE_LIMIT_PER_MIN     — default 100
 *   LOG_LEVEL              — default info
 */

import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { z } from 'zod';

import {
  refreshAccountBalances,
  consolidateCashPosition,
  getAccounts,
  getLastRefreshAttempt,
  refreshFxRates,
  getFxRateSnapshot,
} from './consolidator';
import {
  listRules,
  addRule,
  updateRule,
  deleteRule,
  evaluateRules,
  getExecutionLog,
  listPendingApprovals,
  resolveApproval,
} from './rules-engine';
import {
  addFlow,
  listFlows,
  calculateNetting,
  clearSettledFlows,
  getNettingSummary,
  generateSettlementInstructions,
  dispatchSettlementInstructions,
  getSettlementHistory,
} from './netting';
import type { CashPosition, TreasuryRule, NettingFlow } from './types';

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT                       = parseInt(process.env['PORT'] ?? '3012', 10);
const BANK_CONNECTIVITY_URL      = process.env['BANK_CONNECTIVITY_URL'] ?? 'http://localhost:3006';
const RATE_LIMIT_PER_MIN         = parseInt(process.env['RATE_LIMIT_PER_MIN'] ?? '100', 10);
const RULES_EVAL_INTERVAL_MS     = 60_000;
const BALANCE_REFRESH_INTERVAL_MS = 15 * 60_000;
const FX_REFRESH_INTERVAL_MS     = 60 * 60_000;

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

  await app.register(helmet, {
    contentSecurityPolicy: false, // API service — no HTML pages
  });

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
    version:     '0.2.0',
    port:        PORT,
    lastRefresh: getLastRefreshAttempt(),
    fxRates:     getFxRateSnapshot(),
    timestamp:   new Date().toISOString(),
  }));

  // ── Cash position ──────────────────────────────────────────────────────────

  app.get('/v1/cash-position', async (_req, reply) => {
    const accounts  = getAccounts();
    const position: CashPosition = consolidateCashPosition(accounts);
    return reply.send({ data: position });
  });

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

  // ── FX rates ───────────────────────────────────────────────────────────────

  app.get('/v1/fx-rates', async (_req, reply) => {
    return reply.send(getFxRateSnapshot());
  });

  app.post('/v1/fx-rates/refresh', async (_req, reply) => {
    const rates = await refreshFxRates();
    return reply.send({ rates, refreshedAt: new Date().toISOString() });
  });

  // ── Treasury rules ─────────────────────────────────────────────────────────

  app.get('/v1/rules', async (_req, reply) => {
    const all = listRules();
    return reply.send({ data: all, total: all.length });
  });

  app.post('/v1/rules', async (req, reply) => {
    const parse = TreasuryRuleCreateSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const rule = addRule(parse.data as Omit<TreasuryRule, 'executionCount'>);
    return reply.status(201).send({ data: rule });
  });

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

  app.delete<{ Params: { id: string } }>('/v1/rules/:id', async (req, reply) => {
    const deleted = deleteRule(req.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'NotFound', message: `Rule ${req.params.id} not found` });
    }
    return reply.status(204).send();
  });

  app.post('/v1/rules/evaluate', async (_req, reply) => {
    const accounts  = getAccounts();
    const position  = consolidateCashPosition(accounts);
    const results   = await evaluateRules(position);
    return reply.send({
      data:      results,
      evaluated: results.length,
      executed:  results.filter(r => r.result === 'executed').length,
      skipped:   results.filter(r => r.result === 'skipped').length,
      pending:   results.filter(r => r.result === 'approval_required').length,
      timestamp: new Date().toISOString(),
    });
  });

  app.get<{ Querystring: { limit?: string } }>('/v1/rules/execution-log', async (req, reply) => {
    const limit = parseInt((req.query as { limit?: string }).limit ?? '50', 10);
    return reply.send({ data: getExecutionLog(Math.min(limit, 200)) });
  });

  // ── Approval workflow ──────────────────────────────────────────────────────

  app.get('/v1/rules/approvals', async (_req, reply) => {
    const approvals = listPendingApprovals();
    return reply.send({ data: approvals, total: approvals.length });
  });

  app.post<{ Params: { id: string }; Body: { approved: boolean; resolvedBy: string } }>(
    '/v1/rules/approvals/:id/resolve',
    async (req, reply) => {
      const { approved, resolvedBy } = req.body ?? {};
      if (typeof approved !== 'boolean' || !resolvedBy) {
        return reply.status(400).send({ error: 'approved (boolean) and resolvedBy (string) required' });
      }
      const result = resolveApproval(req.params.id, approved, resolvedBy);
      if (!result) {
        return reply.status(404).send({ error: 'Approval not found or already resolved' });
      }
      return reply.send({ data: result });
    },
  );

  // ── Intercompany netting ───────────────────────────────────────────────────

  app.get('/v1/netting/flows', async (_req, reply) => {
    const flows = listFlows();
    return reply.send({ data: flows, total: flows.length });
  });

  app.post('/v1/netting/flows', async (req, reply) => {
    const parse = NettingFlowSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const flow: NettingFlow = parse.data;
    addFlow(flow);
    return reply.status(201).send({ data: flow });
  });

  app.get('/v1/netting/calculate', async (_req, reply) => {
    const results = calculateNetting();
    const summary = getNettingSummary();
    return reply.send({ data: results, summary, total: results.length });
  });

  /**
   * GET /v1/netting/instructions
   * Generates settlement instructions from current netting results without executing.
   * Use this to preview before calling /v1/netting/settle?execute=true.
   */
  app.get('/v1/netting/instructions', async (_req, reply) => {
    const instructions = generateSettlementInstructions();
    return reply.send({ data: instructions, total: instructions.length });
  });

  /**
   * POST /v1/netting/settle?execute=true
   * Generates settlement instructions and (when execute=true) dispatches them
   * to bank-connectivity. Always clears the netting queue afterward.
   */
  app.post<{ Querystring: { execute?: string } }>('/v1/netting/settle', async (req, reply) => {
    const execute   = req.query.execute === 'true';
    const summary   = getNettingSummary();
    const flowCount = listFlows().length;
    const instructions = generateSettlementInstructions();

    let dispatchResult: typeof instructions = instructions;
    if (execute && instructions.length > 0) {
      dispatchResult = await dispatchSettlementInstructions(instructions, BANK_CONNECTIVITY_URL);
    }

    clearSettledFlows();

    return reply.send({
      message:      execute ? 'Settlement instructions dispatched' : 'Settlement instructions generated (dry-run)',
      settled:      flowCount,
      summary,
      instructions: dispatchResult,
      dispatched:   dispatchResult.filter(i => i.status === 'dispatched').length,
      failed:       dispatchResult.filter(i => i.status === 'failed').length,
      settledAt:    new Date().toISOString(),
    });
  });

  app.get<{ Querystring: { limit?: string } }>('/v1/netting/history', async (req, reply) => {
    const limit = parseInt(req.query.limit ?? '50', 10);
    return reply.send({ data: getSettlementHistory(Math.min(limit, 500)) });
  });

  // ── Forge Agent tools ──────────────────────────────────────────────────────
  // Machine-readable endpoint for AI agents to query and act on treasury data.

  app.get('/v1/agent/tools', async (_req, reply) => {
    return reply.send({
      tools: [
        {
          name:        'get_cash_position',
          description: 'Returns consolidated cash position across all subsidiaries',
          endpoint:    'GET /v1/cash-position',
        },
        {
          name:        'list_rules',
          description: 'Lists all active treasury rules and their last execution state',
          endpoint:    'GET /v1/rules',
        },
        {
          name:        'evaluate_rules',
          description: 'Manually triggers a rule evaluation cycle',
          endpoint:    'POST /v1/rules/evaluate',
        },
        {
          name:        'netting_summary',
          description: 'Returns intercompany netting statistics (gross vs net, fees saved)',
          endpoint:    'GET /v1/netting/calculate',
        },
        {
          name:        'pending_approvals',
          description: 'Lists treasury rules awaiting CFO approval',
          endpoint:    'GET /v1/rules/approvals',
        },
        {
          name:        'fx_rates',
          description: 'Returns current FX rate snapshot',
          endpoint:    'GET /v1/fx-rates',
        },
      ],
    });
  });

  app.get('/v1/agent/summary', async (_req, reply) => {
    const accounts = getAccounts();
    const position = consolidateCashPosition(accounts);
    const netting  = getNettingSummary();
    const rules    = listRules();
    const pending  = listPendingApprovals();

    return reply.send({
      cashPosition: {
        totalUsd:               position.totalUsd,
        idleCashUsd:            position.idleCashUsd,
        deployedInYieldUsd:     position.deployedInYieldUsd,
        opportunityCostPerYear: position.opportunityCostUsdPerYear,
        subsidiaryCount:        Object.keys(position.bySubsidiary).length,
        currencyCount:          Object.keys(position.byCurrency).length,
      },
      rules: {
        total:   rules.length,
        enabled: rules.filter(r => r.enabled).length,
        pendingApprovals: pending.length,
      },
      netting: netting,
      fxRates: getFxRateSnapshot(),
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
  const rulesInterval = setInterval(async () => {
    try {
      const accounts = getAccounts();
      if (accounts.length === 0) return;
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

  const refreshInterval = setInterval(async () => {
    try {
      const accounts = await refreshAccountBalances(BANK_CONNECTIVITY_URL);
      app.log.info({ count: accounts.length }, '[treasury] Account balances refreshed');
    } catch (err) {
      app.log.warn({ err }, '[treasury] Scheduled balance refresh failed');
    }
  }, BALANCE_REFRESH_INTERVAL_MS);

  const fxInterval = setInterval(async () => {
    try {
      await refreshFxRates();
      app.log.debug('[treasury] FX rates refreshed');
    } catch (err) {
      app.log.warn({ err }, '[treasury] FX rate refresh failed');
    }
  }, FX_REFRESH_INTERVAL_MS);

  const cleanup = () => {
    clearInterval(rulesInterval);
    clearInterval(refreshInterval);
    clearInterval(fxInterval);
  };
  process.once('SIGTERM', cleanup);
  process.once('SIGINT',  cleanup);

  app.log.info('[treasury] Scheduler started — rules every 60s, balance every 15m, FX every 60m');
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

  // Pre-warm: initial FX rates + balance load (non-blocking)
  Promise.all([
    refreshFxRates(),
    refreshAccountBalances(BANK_CONNECTIVITY_URL)
      .then(a => app.log.info({ count: a.length }, '[treasury] Initial account load complete'))
      .catch(err => app.log.warn({ err }, '[treasury] Initial account load failed')),
  ]).catch(() => {});

  startScheduler(app);

  await app.listen({ port: PORT, host: '0.0.0.0' });

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          ForgePay Enterprise Treasury v0.2.0                 ║
║          Listening on port ${PORT}                              ║
║                                                              ║
║  Cash Position   →  GET  /v1/cash-position                   ║
║  Force Refresh   →  POST /v1/refresh                         ║
║  Treasury Rules  →  GET  /v1/rules                           ║
║  Run Cycle       →  POST /v1/rules/evaluate                  ║
║  Approvals       →  GET  /v1/rules/approvals                 ║
║  Netting Calc    →  GET  /v1/netting/calculate               ║
║  FX Rates        →  GET  /v1/fx-rates                        ║
║  Agent Summary   →  GET  /v1/agent/summary                   ║
╚══════════════════════════════════════════════════════════════╝
`);
}

main().catch((err) => {
  console.error('[enterprise-treasury] Fatal startup error:', err);
  process.exit(1);
});

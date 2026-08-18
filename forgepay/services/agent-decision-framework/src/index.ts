/**
 * ForgePay Agent Decision Framework
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Autonomous decision logic for AI agents — risk scoring, counterparty
 *       trust evaluation, and policy-based approval workflows.
 *
 * Features:
 *   1. Deterministic Risk Scoring      — reputation + amount + velocity + policy
 *   2. Global Policy CRUD              — rule-based gates evaluated per request
 *   3. Per-Agent Policy Overrides      — risk tolerance, daily limits, blocklist
 *   4. Velocity Tracking               — rolling 1h/24h/7d windows per agent
 *   5. Decision Audit Log              — last 500 decisions, queryable
 *
 * Port: 3013
 *
 * Env vars:
 *   AGENT_IDENTITY_URL     — default http://localhost:3010
 *   AGENT_IDENTITY_API_KEY — key sent to agent-identity's protected routes
 *   ADF_ADMIN_API_KEY      — operator key (all scopes); required in production
 *   ADF_SERVICE_API_KEYS   — comma-separated internal-caller keys (evaluate + read)
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
  listPolicies,
  getPolicy,
  addPolicy,
  updatePolicy,
  deletePolicy,
  getAgentPolicy,
  setAgentPolicy,
} from './policies';
import { decide, fetchReputation } from './risk-scorer';
import { recordDecision, getDecisionHistory } from './decision-log';
import { recordTransaction, getVelocity } from './velocity';
import { registerAuth } from './auth';
import { instrumentationPlugin } from './lib/instrumentation';
import type { DecisionPolicy } from './types';

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT                = parseInt(process.env['PORT'] ?? '3013', 10);
const AGENT_IDENTITY_URL  = process.env['AGENT_IDENTITY_URL'] ?? 'http://localhost:3010';
const RATE_LIMIT_PER_MIN  = parseInt(process.env['RATE_LIMIT_PER_MIN'] ?? '100', 10);

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ActionTypeSchema = z.enum(['payment', 'transfer', 'swap', 'subscription', 'refund', 'payout', 'custom']);

const DecisionRequestSchema = z.object({
  agentId:              z.string().min(1),
  actionType:           ActionTypeSchema,
  counterpartyAgentId:  z.string().min(1).optional(),
  amountUsd:            z.number().nonnegative(),
  asset:                z.string().min(1),
  metadata:             z.record(z.unknown()).optional(),
});

const PolicyTypeSchema = z.enum([
  'block_low_reputation',
  'block_high_amount',
  'require_approval_above',
  'block_blocked_counterparty',
  'block_velocity_exceeded',
  'block_unknown_counterparty',
]);

const PolicyParamsSchema = z.object({
  minReputation:      z.number().min(0).max(100).optional(),
  maxAmountUsd:       z.number().nonnegative().optional(),
  thresholdUsd:       z.number().nonnegative().optional(),
  maxDailyVolumeUsd:  z.number().nonnegative().optional(),
}).strict();

const PolicyCreateSchema = z.object({
  id:       z.string().min(1),
  name:     z.string().min(1),
  type:     PolicyTypeSchema,
  params:   PolicyParamsSchema.default({}),
  enabled:  z.boolean().default(true),
});

const PolicyUpdateSchema = PolicyCreateSchema.partial().omit({ id: true });

const AgentPolicyUpdateSchema = z.object({
  riskTolerance:                 z.number().min(0).max(100).optional(),
  dailyLimitUsd:                 z.number().positive().optional(),
  blockedCounterparties:         z.array(z.string().min(1)).optional(),
  requiredApprovalThresholdUsd:  z.number().positive().optional(),
});

/**
 * Resolve the CORS origin allowlist.
 *
 * `CORS_ORIGIN` defaults to `*` for local/demo use. That default reaching
 * production would let any website's browser JS read every response this
 * service returns. Comma-separated origins are supported so a real
 * deployment can list every trusted caller (dashboard, mobile web, ...)
 * rather than being forced back to `*` for lack of a multi-origin option.
 *
 * @throws in production when CORS_ORIGIN is unset or still `*`.
 */
export function resolveCorsOrigin(): string | string[] {
  const raw = process.env['CORS_ORIGIN'];
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (isProduction && (!raw || raw === '*')) {
    throw new Error(
      'CORS_ORIGIN is not set (or is "*") in production. The decision framework refuses to ' +
      'start without an explicit origin allowlist — set it to a comma-separated list of ' +
      'trusted origins, e.g. CORS_ORIGIN=https://dashboard.forgepay.io,https://app.forgepay.io',
    );
  }

  if (!raw) return '*';
  const origins = raw.split(',').map((o) => o.trim()).filter(Boolean);
  return origins.length === 1 ? origins[0]! : origins;
}

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
    origin:      resolveCorsOrigin(),
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

  registerAuth(app);
  await app.register(instrumentationPlugin);

  // ── Health probe ───────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status:           'ok',
    service:          'agent-decision-framework',
    version:          '0.1.0',
    port:             PORT,
    agentIdentityUrl: AGENT_IDENTITY_URL,
    policyCount:      listPolicies().length,
    timestamp:        new Date().toISOString(),
  }));

  // ── Metrics ────────────────────────────────────────────────────────────────
  app.get('/metrics', async (_req, reply) => {
    const { Metrics } = await import('./lib/metrics.js');
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(await Metrics.register());
  });

  // ── Decision evaluation ────────────────────────────────────────────────────

  app.post('/v1/decisions/evaluate', async (req, reply) => {
    const parse = DecisionRequestSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const request     = parse.data;
    const agentPolicy = getAgentPolicy(request.agentId);
    const policies    = listPolicies();
    const velocity    = getVelocity(request.agentId);

    let reputation: number | null = null;
    if (request.counterpartyAgentId) {
      reputation = await fetchReputation(AGENT_IDENTITY_URL, request.counterpartyAgentId);
    }

    const decision = decide({ request, agentPolicy, policies, velocity, reputation });
    recordDecision(decision);

    // Approved or pending decisions count toward velocity; rejects do not.
    if (decision.decision !== 'reject') {
      recordTransaction(request.agentId, request.amountUsd);
    }

    return reply.send({ data: decision });
  });

  // ── Global policy CRUD ─────────────────────────────────────────────────────

  app.get('/v1/policies', async (_req, reply) => {
    const all = listPolicies();
    return reply.send({ data: all, total: all.length });
  });

  app.post('/v1/policies', async (req, reply) => {
    const parse = PolicyCreateSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    if (getPolicy(parse.data.id)) {
      return reply.status(409).send({ error: 'Conflict', message: `Policy ${parse.data.id} already exists` });
    }
    const policy = addPolicy(parse.data as DecisionPolicy);
    return reply.status(201).send({ data: policy });
  });

  app.put<{ Params: { id: string } }>('/v1/policies/:id', async (req, reply) => {
    const parse = PolicyUpdateSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const updated = updatePolicy(req.params.id, parse.data as Partial<DecisionPolicy>);
    if (!updated) {
      return reply.status(404).send({ error: 'NotFound', message: `Policy ${req.params.id} not found` });
    }
    return reply.send({ data: updated });
  });

  app.delete<{ Params: { id: string } }>('/v1/policies/:id', async (req, reply) => {
    const deleted = deletePolicy(req.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'NotFound', message: `Policy ${req.params.id} not found` });
    }
    return reply.status(204).send();
  });

  // ── Per-agent policy ───────────────────────────────────────────────────────

  app.get<{ Params: { agentId: string } }>('/v1/agents/:agentId/policy', async (req, reply) => {
    return reply.send({ data: getAgentPolicy(req.params.agentId) });
  });

  app.put<{ Params: { agentId: string } }>('/v1/agents/:agentId/policy', async (req, reply) => {
    const parse = AgentPolicyUpdateSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const updated = setAgentPolicy(req.params.agentId, parse.data);
    return reply.send({ data: updated });
  });

  // ── Velocity ───────────────────────────────────────────────────────────────

  app.get<{ Params: { agentId: string } }>('/v1/agents/:agentId/velocity', async (req, reply) => {
    return reply.send({ data: getVelocity(req.params.agentId) });
  });

  // ── Decision history ───────────────────────────────────────────────────────

  app.get<{ Querystring: { limit?: string } }>('/v1/decisions/history', async (req, reply) => {
    const limit = parseInt((req.query as { limit?: string }).limit ?? '50', 10);
    const data  = getDecisionHistory(Math.min(Math.max(limit, 1), 500));
    return reply.send({ data, total: data.length });
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

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async () => {
    app.log.info('[agent-decision] Shutting down...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  // ── Global error handlers (prevent silent pod crashes) ────────────────
  process.on('unhandledRejection', (reason, promise) => {
    app.log.error({ reason, promise }, 'Unhandled Rejection');
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    app.log.error({ error }, 'Uncaught Exception');
    process.exit(1);
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║       ForgePay Agent Decision Framework v0.1.0               ║
║       Listening on port ${PORT}                                 ║
║                                                              ║
║  Evaluate       →  POST /v1/decisions/evaluate               ║
║  Policies       →  GET  /v1/policies                         ║
║  Agent Policy   →  GET  /v1/agents/:agentId/policy           ║
║  Velocity       →  GET  /v1/agents/:agentId/velocity         ║
║  History        →  GET  /v1/decisions/history                ║
╚══════════════════════════════════════════════════════════════╝
`);
}

// Only auto-start when executed directly (not when imported by tests).
if (require.main === module) {
  main().catch((err) => {
    console.error('[agent-decision-framework] Fatal startup error:', err);
    process.exit(1);
  });
}

export { buildApp };

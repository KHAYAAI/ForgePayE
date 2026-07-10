/**
 * ForgePay Agent Negotiation Protocol
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Structured negotiation between AI agents — offer/counter-offer protocol,
 *       escrow creation and management, and settlement.
 *
 * Port: 3011
 *
 * Routes:
 *   GET  /health
 *   POST /v1/sessions                        — create negotiation session
 *   GET  /v1/sessions                        — list sessions (with filters)
 *   GET  /v1/sessions/:id                    — get session with full message history
 *   POST /v1/sessions/:id/messages           — add message to session
 *   POST /v1/sessions/:id/accept             — accept current terms (shortcut)
 *   POST /v1/sessions/:id/reject             — reject negotiation (shortcut)
 *   GET  /v1/sessions/:id/agreed-terms       — get final agreed terms
 *   POST /v1/escrow                          — create escrow linked to session
 *   POST /v1/escrow/:id/fund                 — fund escrow (debits buyer's ledger balance)
 *   POST /v1/escrow/:id/release              — release escrow to seller (credits ledger)
 *   POST /v1/escrow/:id/refund               — refund to buyer (credits ledger)
 *   POST /v1/escrow/:id/dispute              — open dispute
 *   GET  /v1/escrow/:id                      — get escrow status
 *   POST /v1/agents/:agentId/balance/deposit — ADMIN/TEST/INTERNAL: credit an agent's
 *                                               internal ledger balance (see ledger.ts —
 *                                               real on-chain funding is not wired yet)
 *   GET  /v1/agents/:agentId/balance         — current ledger balance + audit trail
 */

import Fastify, { type FastifyError } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import apiKeyAuth from './plugins/api-key-auth';

import { getSession, listSessions, getEscrow, initStore } from './store';
import { createSession, addMessage, getAgreedTerms, isExpired } from './negotiation';
import { createEscrow, fundEscrow, releaseEscrow, refundEscrow, disputeEscrow } from './escrow';
import { deposit as depositAgentBalance, getBalance, getLedgerEntries } from './ledger';
import type { NegotiationSession, NegotiationTerm, MessageRole } from './types';

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT       = parseInt(process.env['PORT'] ?? '3011', 10);
const RATE_LIMIT = parseInt(process.env['RATE_LIMIT_PER_MIN'] ?? '200', 10);

const VALID_ROLES: MessageRole[] = ['offer', 'counter_offer', 'accept', 'reject', 'cancel', 'settle'];
const VALID_ASSETS               = ['USDC', 'USDT'] as const;
const VALID_CHAINS               = ['base', 'ethereum', 'polygon'] as const;

// ── App builder ───────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({
    logger:     { level: process.env['LOG_LEVEL'] ?? 'info' },
    trustProxy: true,
  });

  // ── Plugins ────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin:      process.env['CORS_ORIGIN'] ?? '*',
    methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false,
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(rateLimit, {
    max:        RATE_LIMIT,
    timeWindow: '1 minute',
    keyGenerator: (req) =>
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error:      'Too Many Requests',
      message:    `Rate limit exceeded. Retry in ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });

  await app.register(apiKeyAuth);

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status:    'ok',
    service:   'agent-negotiation',
    version:   '0.1.0',
    port:      PORT,
    timestamp: new Date().toISOString(),
  }));

  // ── Metrics ────────────────────────────────────────────────────────────────
  app.get('/metrics', async (_req, reply) => {
    const { Metrics } = await import('./lib/metrics.js');
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(await Metrics.register());
  });

  // ── POST /v1/sessions — Create session ────────────────────────────────────
  app.post('/v1/sessions', async (req, reply) => {
    const body = req.body as Record<string, unknown>;

    if (!body['initiatorAgentId'] || typeof body['initiatorAgentId'] !== 'string') {
      return reply.status(400).send({ error: 'ValidationError', message: 'initiatorAgentId is required' });
    }
    if (!body['responderAgentId'] || typeof body['responderAgentId'] !== 'string') {
      return reply.status(400).send({ error: 'ValidationError', message: 'responderAgentId is required' });
    }
    if (!body['subject'] || typeof body['subject'] !== 'string') {
      return reply.status(400).send({ error: 'ValidationError', message: 'subject is required' });
    }
    if (!Array.isArray(body['initialTerms'])) {
      return reply.status(400).send({ error: 'ValidationError', message: 'initialTerms must be an array' });
    }
    if (body['initiatorAgentId'] === body['responderAgentId']) {
      return reply.status(422).send({ error: 'ValidationError', message: 'initiatorAgentId and responderAgentId must be different agents' });
    }

    const session = await createSession({
      initiatorAgentId: body['initiatorAgentId'] as string,
      responderAgentId: body['responderAgentId'] as string,
      subject:          body['subject'] as string,
      initialTerms:     body['initialTerms'] as NegotiationTerm[],
      maxRounds:        typeof body['maxRounds'] === 'number' ? body['maxRounds'] : undefined,
    });

    app.log.info({ sessionId: session.id }, '[agent-negotiation] Session created');
    return reply.status(201).send({ data: session });
  });

  // ── GET /v1/sessions — List sessions ──────────────────────────────────────
  app.get<{ Querystring: Record<string, string> }>('/v1/sessions', async (req, reply) => {
    const q        = req.query;
    const sessions = await listSessions({
      agentId: q['agentId'],
      status:  q['status'] as NegotiationSession['status'] | undefined,
    });
    return reply.send({ data: sessions, total: sessions.length });
  });

  // ── GET /v1/sessions/:id — Get session ────────────────────────────────────
  app.get<{ Params: { id: string } }>('/v1/sessions/:id', async (req, reply) => {
    const session = await getSession(req.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'NotFound', message: `Session ${req.params.id} not found` });
    }
    // Refresh expiry status on read
    if (isExpired(session) && session.status === 'active') {
      return reply.send({ data: { ...session, status: 'expired' } });
    }
    return reply.send({ data: session });
  });

  // ── POST /v1/sessions/:id/messages — Add message ──────────────────────────
  app.post<{ Params: { id: string } }>('/v1/sessions/:id/messages', async (req, reply) => {
    const body = req.body as Record<string, unknown>;

    if (!body['fromAgentId'] || typeof body['fromAgentId'] !== 'string') {
      return reply.status(400).send({ error: 'ValidationError', message: 'fromAgentId is required' });
    }
    if (!body['role'] || !VALID_ROLES.includes(body['role'] as MessageRole)) {
      return reply.status(400).send({
        error:   'ValidationError',
        message: `role must be one of: ${VALID_ROLES.join(', ')}`,
      });
    }
    if (!Array.isArray(body['terms'])) {
      return reply.status(400).send({ error: 'ValidationError', message: 'terms must be an array' });
    }

    const result = await addMessage(req.params.id, {
      fromAgentId:      body['fromAgentId'] as string,
      role:             body['role'] as MessageRole,
      terms:            body['terms'] as NegotiationTerm[],
      message:          body['message'] as string | undefined,
      expiresInSeconds: typeof body['expiresInSeconds'] === 'number' ? body['expiresInSeconds'] : undefined,
    });

    if ('error' in result && !('session' in result)) {
      const status = result.error.includes('not found') ? 404 : 422;
      return reply.status(status).send({ error: 'NegotiationError', message: result.error });
    }

    const { session, msg } = result as { session: NegotiationSession; msg: unknown };
    return reply.status(201).send({ data: { message: msg, session } });
  });

  // ── POST /v1/sessions/:id/accept — Accept shortcut ────────────────────────
  app.post<{ Params: { id: string } }>('/v1/sessions/:id/accept', async (req, reply) => {
    const body    = req.body as Record<string, unknown>;
    const session = await getSession(req.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'NotFound', message: `Session ${req.params.id} not found` });
    }

    if (!body['fromAgentId'] || typeof body['fromAgentId'] !== 'string') {
      return reply.status(400).send({ error: 'ValidationError', message: 'fromAgentId is required' });
    }

    // Accept with the most recent terms in the session
    const lastMessage = session.messages[session.messages.length - 1];
    const terms       = lastMessage?.terms ?? [];

    const result = await addMessage(req.params.id, {
      fromAgentId: body['fromAgentId'] as string,
      role:        'accept',
      terms,
      message:     body['message'] as string | undefined,
    });

    if ('error' in result && !('session' in result)) {
      return reply.status(422).send({ error: 'NegotiationError', message: result.error });
    }

    const { session: updated } = result as { session: NegotiationSession; msg: unknown };
    return reply.send({ data: updated });
  });

  // ── POST /v1/sessions/:id/reject — Reject shortcut ────────────────────────
  app.post<{ Params: { id: string } }>('/v1/sessions/:id/reject', async (req, reply) => {
    const body    = req.body as Record<string, unknown>;
    const session = await getSession(req.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'NotFound', message: `Session ${req.params.id} not found` });
    }

    if (!body['fromAgentId'] || typeof body['fromAgentId'] !== 'string') {
      return reply.status(400).send({ error: 'ValidationError', message: 'fromAgentId is required' });
    }

    const result = await addMessage(req.params.id, {
      fromAgentId: body['fromAgentId'] as string,
      role:        'reject',
      terms:       [],
      message:     body['reason'] as string | undefined,
    });

    if ('error' in result && !('session' in result)) {
      return reply.status(422).send({ error: 'NegotiationError', message: result.error });
    }

    const { session: updated } = result as { session: NegotiationSession; msg: unknown };
    return reply.send({ data: updated });
  });

  // ── GET /v1/sessions/:id/agreed-terms — Get agreed terms ─────────────────
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/agreed-terms', async (req, reply) => {
    const result = await getAgreedTerms(req.params.id);
    if ('error' in result) {
      const status = result.error.includes('not found') ? 404 : 422;
      return reply.status(status).send({ error: 'NegotiationError', message: result.error });
    }
    return reply.send({ data: result });
  });

  // ── POST /v1/escrow — Create escrow ───────────────────────────────────────
  app.post('/v1/escrow', async (req, reply) => {
    const body = req.body as Record<string, unknown>;

    if (!body['sessionId'] || typeof body['sessionId'] !== 'string') {
      return reply.status(400).send({ error: 'ValidationError', message: 'sessionId is required' });
    }
    if (!body['buyerAgentId'] || typeof body['buyerAgentId'] !== 'string') {
      return reply.status(400).send({ error: 'ValidationError', message: 'buyerAgentId is required' });
    }
    if (!body['sellerAgentId'] || typeof body['sellerAgentId'] !== 'string') {
      return reply.status(400).send({ error: 'ValidationError', message: 'sellerAgentId is required' });
    }
    if (typeof body['amountUsd'] !== 'number' || body['amountUsd'] <= 0) {
      return reply.status(400).send({ error: 'ValidationError', message: 'amountUsd must be a positive number' });
    }
    if (!body['asset'] || !VALID_ASSETS.includes(body['asset'] as typeof VALID_ASSETS[number])) {
      return reply.status(400).send({ error: 'ValidationError', message: `asset must be one of: ${VALID_ASSETS.join(', ')}` });
    }
    if (!body['chain'] || !VALID_CHAINS.includes(body['chain'] as typeof VALID_CHAINS[number])) {
      return reply.status(400).send({ error: 'ValidationError', message: `chain must be one of: ${VALID_CHAINS.join(', ')}` });
    }

    const result = await createEscrow({
      sessionId:     body['sessionId'] as string,
      buyerAgentId:  body['buyerAgentId'] as string,
      sellerAgentId: body['sellerAgentId'] as string,
      amountUsd:     body['amountUsd'] as number,
      asset:         body['asset'] as 'USDC' | 'USDT',
      chain:         body['chain'] as 'base' | 'ethereum' | 'polygon',
    });

    if ('error' in result) {
      return reply.status(404).send({ error: 'NotFound', message: result.error });
    }

    app.log.info({ escrowId: result.id, sessionId: result.sessionId }, '[agent-negotiation] Escrow created');
    return reply.status(201).send({ data: result });
  });

  // ── POST /v1/escrow/:id/fund — Fund escrow ────────────────────────────────
  app.post<{ Params: { id: string } }>('/v1/escrow/:id/fund', async (req, reply) => {
    app.log.info({ escrowId: req.params.id }, '[agent-negotiation] Escrow fund requested — debiting buyer ledger balance');
    const result = await fundEscrow(req.params.id);
    if ('error' in result) {
      const status = result.error.includes('not found') ? 404 : 422;
      return reply.status(status).send({ error: 'EscrowError', message: result.error });
    }
    return reply.send({ data: result });
  });

  // ── POST /v1/escrow/:id/release — Release escrow ─────────────────────────
  app.post<{ Params: { id: string } }>('/v1/escrow/:id/release', async (req, reply) => {
    const body            = req.body as Record<string, unknown>;
    const settlementTxId  = body['settlementTxId'] as string | undefined;
    const result          = await releaseEscrow(req.params.id, settlementTxId);
    if ('error' in result) {
      const status = result.error.includes('not found') ? 404 : 422;
      return reply.status(status).send({ error: 'EscrowError', message: result.error });
    }
    app.log.info({ escrowId: req.params.id, settlementTxId }, '[agent-negotiation] Escrow released');
    return reply.send({ data: result });
  });

  // ── POST /v1/escrow/:id/refund — Refund escrow ────────────────────────────
  app.post<{ Params: { id: string } }>('/v1/escrow/:id/refund', async (req, reply) => {
    const body   = req.body as Record<string, unknown>;
    const reason = typeof body['reason'] === 'string' ? body['reason'] : 'No reason provided';
    const result = await refundEscrow(req.params.id, reason);
    if ('error' in result) {
      const status = result.error.includes('not found') ? 404 : 422;
      return reply.status(status).send({ error: 'EscrowError', message: result.error });
    }
    app.log.info({ escrowId: req.params.id, reason }, '[agent-negotiation] Escrow refunded');
    return reply.send({ data: result });
  });

  // ── POST /v1/escrow/:id/dispute — Open dispute ────────────────────────────
  app.post<{ Params: { id: string } }>('/v1/escrow/:id/dispute', async (req, reply) => {
    const body   = req.body as Record<string, unknown>;
    const reason = typeof body['reason'] === 'string' ? body['reason'] : 'Dispute opened without reason';
    const result = await disputeEscrow(req.params.id, reason);
    if ('error' in result) {
      const status = result.error.includes('not found') ? 404 : 422;
      return reply.status(status).send({ error: 'EscrowError', message: result.error });
    }
    app.log.info({ escrowId: req.params.id, reason }, '[agent-negotiation] Escrow disputed');
    return reply.send({ data: result });
  });

  // ── GET /v1/escrow/:id — Get escrow status ────────────────────────────────
  app.get<{ Params: { id: string } }>('/v1/escrow/:id', async (req, reply) => {
    const escrow = await getEscrow(req.params.id);
    if (!escrow) {
      return reply.status(404).send({ error: 'NotFound', message: `Escrow ${req.params.id} not found` });
    }
    return reply.send({ data: escrow });
  });

  // ── POST /v1/agents/:agentId/balance/deposit — Deposit (ADMIN/TEST/INTERNAL) ─
  // Credits an agent's internal escrow-ledger balance. Real on-chain funding
  // is NOT wired yet (see escrow.ts / ledger.ts module comments) — this
  // exists purely so the ledger's lock/release/refund accounting is
  // testable end-to-end. This is an internal/admin operation: it is gated
  // by the same shared API key as every other route here, which is NOT
  // sufficient authorization for a production money-movement endpoint.
  const depositSchema = z.object({
    amountUsd: z.number().positive().finite(),
  });

  app.post<{ Params: { agentId: string } }>('/v1/agents/:agentId/balance/deposit', async (req, reply) => {
    const parsed = depositSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error:   'ValidationError',
        message: 'amountUsd is required and must be a positive finite number',
        detail:  parsed.error.flatten(),
      });
    }

    const result = depositAgentBalance(req.params.agentId, parsed.data.amountUsd);
    app.log.info(
      { agentId: req.params.agentId, amountUsd: parsed.data.amountUsd },
      '[agent-negotiation] Agent ledger balance deposit (admin/test/internal — not real on-chain funding)'
    );
    return reply.status(201).send({ data: result });
  });

  // ── GET /v1/agents/:agentId/balance — Current balance + audit trail ──────
  app.get<{ Params: { agentId: string } }>('/v1/agents/:agentId/balance', async (req, reply) => {
    return reply.send({
      data: {
        agentId:    req.params.agentId,
        balanceUsd: getBalance(req.params.agentId),
        ledger:     getLedgerEntries(req.params.agentId),
      },
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

export { buildApp };

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await initStore();

  const app = await buildApp();

  const shutdown = async () => {
    app.log.info('[agent-negotiation] Shutting down...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

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
║          ForgePay Agent Negotiation Protocol                 ║
║          Listening on port ${PORT}                              ║
║                                                              ║
║  Create Session   →  POST /v1/sessions                       ║
║  Add Message      →  POST /v1/sessions/:id/messages          ║
║  Accept Terms     →  POST /v1/sessions/:id/accept            ║
║  Create Escrow    →  POST /v1/escrow                         ║
║  Release Escrow   →  POST /v1/escrow/:id/release             ║
╚══════════════════════════════════════════════════════════════╝
`);
}

// Only auto-start when this module is the actual process entrypoint (e.g.
// `node dist/index.js`) — not when it's `import`ed for `buildApp` (as the
// test suite does), which would otherwise start a second real listener on
// the same port as a side effect of merely importing the module.
if (require.main === module) {
  main().catch((err) => {
    console.error('[agent-negotiation] Fatal startup error:', err);
    process.exit(1);
  });
}

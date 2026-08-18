/**
 * ForgePay Agent Identity Registry
 * ──────────────────────────────────────────────────────────────────────────
 * Role: DID-based identity management for AI agents — registration, reputation
 *       scoring, attestations, and discovery.
 *
 * Port: 3010
 *
 * Routes:
 *   GET  /health
 *   POST /v1/agents                          — register agent
 *   GET  /v1/agents                          — list agents (with filters)
 *   GET  /v1/agents/:id                      — get agent by ID or DID
 *   PUT  /v1/agents/:id                      — update agent
 *   DELETE /v1/agents/:id                    — deregister agent
 *   POST /v1/agents/:id/reputation           — record reputation event
 *   GET  /v1/agents/:id/reputation           — get reputation history
 *   POST /v1/agents/:id/attestations         — add attestation
 *   GET  /v1/agents/:id/attestations         — list attestations
 *   GET  /v1/discover                        — discover agents by capability
 *   POST /v1/verify-signature                — verify Ed25519 signature
 */

import Fastify, { type FastifyError } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { mintAgentDid } from './did';
import { createVerify } from 'crypto';
import apiKeyAuth, { agentAccessError } from './plugins/api-key-auth';

import {
  getAgent,
  setAgent,
  listAgents,
  getReputationEventsByAgentId,
  getAttestationsBySubjectAgentId,
  setAttestation,
  initStore,
} from './store';
import { buildKYAPayRoutes } from './routes/kyapay';
import { recordReputationEvent } from './reputation';
import type { AgentIdentity, Attestation, ReputationEvent } from './types';

// ── Configuration ─────────────────────────────────────────────────────────

const PORT = parseInt(process.env['PORT'] ?? '3010', 10);
const RATE_LIMIT = parseInt(process.env['RATE_LIMIT_PER_MIN'] ?? '200', 10);
const VALID_FRAMEWORKS = [
  'elizaos',
  'swarms',
  'autogen',
  'langchain',
  'crewai',
  'forgepay',
  'custom',
] as const;
const VALID_EVENT_TYPES: ReputationEvent['eventType'][] = [
  'transaction_success',
  'transaction_failure',
  'dispute_raised',
  'dispute_resolved',
  'late_payment',
  'fraud_detected',
  'vouched_by_trusted',
];

// ── App builder ───────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    trustProxy: true,
  });

  // ── Plugins ────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] ?? '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false,
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(rateLimit, {
    max: RATE_LIMIT,
    timeWindow: '1 minute',
    keyGenerator: (req) =>
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry in ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });

  await app.register(apiKeyAuth);

  // ── KYAPay routes (JWKS is public; import/token endpoints use API key auth) ─
  await app.register(buildKYAPayRoutes);

  // ── Health ─────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    service: 'agent-identity',
    version: '0.1.0',
    port: PORT,
    timestamp: new Date().toISOString(),
  }));

  // ── Metrics ────────────────────────────────────────────────────────────
  app.get('/metrics', async (_req, reply) => {
    const { register } = await import('./lib/metrics.js');
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(await register.metrics());
  });

  // ── POST /v1/agents — Register agent ──────────────────────────────────
  app.post('/v1/agents', async (req, reply) => {
    const body = req.body as Record<string, unknown>;

    if (!body['name'] || typeof body['name'] !== 'string') {
      return reply
        .status(400)
        .send({ error: 'ValidationError', message: 'name is required' });
    }
    if (
      !body['framework'] ||
      !VALID_FRAMEWORKS.includes(body['framework'] as typeof VALID_FRAMEWORKS[number])
    ) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: `framework must be one of: ${VALID_FRAMEWORKS.join(', ')}`,
      });
    }
    if (!body['ownerMerchantId'] || typeof body['ownerMerchantId'] !== 'string') {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'ownerMerchantId is required',
      });
    }
    // A merchant-tier key may only register agents under its own
    // ownerMerchantId — otherwise any valid key could mint agents that
    // appear owned by a competitor. Admin keys may register on behalf of
    // any merchant.
    if (req.auth?.kind !== 'admin' && body['ownerMerchantId'] !== req.auth?.principalId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'ownerMerchantId must match the authenticated merchant.',
      });
    }
    if (body['reputationScore'] !== undefined) {
      const score = body['reputationScore'];
      if (typeof score !== 'number' || score < 0 || score > 1000) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'reputationScore must be a number between 0 and 1000',
        });
      }
    }
    if (body['capabilities'] !== undefined) {
      if (
        !Array.isArray(body['capabilities']) ||
        !(body['capabilities'] as unknown[]).every((c) => typeof c === 'string')
      ) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'capabilities must be an array of strings',
        });
      }
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    const agent: AgentIdentity = {
      id,
      did: mintAgentDid(id),
      name: body['name'] as string,
      framework: body['framework'] as AgentIdentity['framework'],
      ownerMerchantId: body['ownerMerchantId'] as string,
      publicKey: body['publicKey'] as string | undefined,
      webhookUrl: body['webhookUrl'] as string | undefined,
      capabilities: Array.isArray(body['capabilities'])
        ? (body['capabilities'] as string[])
        : [],
      trustLevel: 'unverified',
      reputationScore: 500,
      totalTransactions: 0,
      totalVolumeUsd: 0,
      successRate: 1.0,
      averageResponseTimeMs: 0,
      tags: Array.isArray(body['tags']) ? (body['tags'] as string[]) : [],
      createdAt: now,
      lastActiveAt: now,
      status: 'active',
    };

    await setAgent(agent);
    app.log.info({ agentId: id, did: agent.did }, '[agent-identity] Agent registered');
    return reply.status(201).send({ data: agent });
  });

  // ── GET /v1/agents — List agents ──────────────────────────────────────
  app.get<{ Querystring: Record<string, string> }>('/v1/agents', async (req, reply) => {
    const q = req.query;
    const agents = await listAgents({
      framework: q['framework'] as AgentIdentity['framework'] | undefined,
      trustLevel: q['trustLevel'] as AgentIdentity['trustLevel'] | undefined,
      capability: q['capability'],
      tag: q['tag'],
      minReputation: q['minReputation'] ? Number(q['minReputation']) : undefined,
      limit: q['limit'] ? Math.min(Number(q['limit']), 100) : 20,
    });
    return reply.send({ data: agents, total: agents.length });
  });

  // ── GET /v1/agents/:id — Get agent ────────────────────────────────────
  app.get<{ Params: { id: string } }>('/v1/agents/:id', async (req, reply) => {
    const agent = await getAgent(req.params.id);
    if (!agent) {
      return reply
        .status(404)
        .send({ error: 'NotFound', message: `Agent ${req.params.id} not found` });
    }
    const accessError = agentAccessError(req.auth, agent);
    if (accessError) return reply.status(403).send(accessError);
    return reply.send({ data: agent });
  });

  // ── PUT /v1/agents/:id — Update agent ────────────────────────────────
  app.put<{ Params: { id: string } }>('/v1/agents/:id', async (req, reply) => {
    const agent = await getAgent(req.params.id);
    if (!agent) {
      return reply
        .status(404)
        .send({ error: 'NotFound', message: `Agent ${req.params.id} not found` });
    }
    const accessError = agentAccessError(req.auth, agent);
    if (accessError) return reply.status(403).send(accessError);
    if (agent.status === 'deregistered') {
      return reply.status(409).send({
        error: 'Conflict',
        message: 'Cannot update a deregistered agent',
      });
    }

    const body = req.body as Record<string, unknown>;
    const updated: AgentIdentity = {
      ...agent,
      name: typeof body['name'] === 'string' ? body['name'] : agent.name,
      webhookUrl:
        body['webhookUrl'] !== undefined
          ? (body['webhookUrl'] as string)
          : agent.webhookUrl,
      publicKey:
        body['publicKey'] !== undefined ? (body['publicKey'] as string) : agent.publicKey,
      capabilities: Array.isArray(body['capabilities'])
        ? (body['capabilities'] as string[])
        : agent.capabilities,
      tags: Array.isArray(body['tags'])
        ? (body['tags'] as string[])
        : agent.tags,
      lastActiveAt: new Date().toISOString(),
    };
    await setAgent(updated);
    return reply.send({ data: updated });
  });

  // ── DELETE /v1/agents/:id — Deregister agent ──────────────────────────
  app.delete<{ Params: { id: string } }>('/v1/agents/:id', async (req, reply) => {
    const agent = await getAgent(req.params.id);
    if (!agent) {
      return reply
        .status(404)
        .send({ error: 'NotFound', message: `Agent ${req.params.id} not found` });
    }
    const accessError = agentAccessError(req.auth, agent);
    if (accessError) return reply.status(403).send(accessError);
    await setAgent({
      ...agent,
      status: 'deregistered',
      lastActiveAt: new Date().toISOString(),
    });
    app.log.info({ agentId: agent.id }, '[agent-identity] Agent deregistered');
    return reply.status(204).send();
  });

  // ── POST /v1/agents/:id/reputation — Record reputation event ──────────
  app.post<{ Params: { id: string } }>('/v1/agents/:id/reputation', async (req, reply) => {
    const agent = await getAgent(req.params.id);
    if (!agent) {
      return reply
        .status(404)
        .send({ error: 'NotFound', message: `Agent ${req.params.id} not found` });
    }
    const accessError = agentAccessError(req.auth, agent);
    if (accessError) return reply.status(403).send(accessError);

    const body = req.body as Record<string, unknown>;

    if (
      !body['eventType'] ||
      !VALID_EVENT_TYPES.includes(body['eventType'] as ReputationEvent['eventType'])
    ) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: `eventType must be one of: ${VALID_EVENT_TYPES.join(', ')}`,
      });
    }
    if (!body['description'] || typeof body['description'] !== 'string') {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'description is required',
      });
    }

    const result = await recordReputationEvent(
      req.params.id,
      body['eventType'] as ReputationEvent['eventType'],
      body['description'] as string,
      {
        relatedAgentId: body['relatedAgentId'] as string | undefined,
        transactionId: body['transactionId'] as string | undefined,
      }
    );

    if ('error' in result) {
      return reply.status(404).send({ error: 'NotFound', message: result.error });
    }

    return reply.status(201).send({ data: result });
  });

  // ── GET /v1/agents/:id/reputation — List reputation history ───────────
  app.get<{ Params: { id: string } }>('/v1/agents/:id/reputation', async (req, reply) => {
    const agent = await getAgent(req.params.id);
    if (!agent) {
      return reply
        .status(404)
        .send({ error: 'NotFound', message: `Agent ${req.params.id} not found` });
    }
    const accessError = agentAccessError(req.auth, agent);
    if (accessError) return reply.status(403).send(accessError);
    const events = await getReputationEventsByAgentId(req.params.id);
    return reply.send({ data: events, total: events.length });
  });

  // ── POST /v1/agents/:id/attestations — Add attestation ───────────────
  app.post<{ Params: { id: string } }>('/v1/agents/:id/attestations', async (req, reply) => {
    const agent = await getAgent(req.params.id);
    if (!agent) {
      return reply
        .status(404)
        .send({ error: 'NotFound', message: `Agent ${req.params.id} not found` });
    }
    const accessError = agentAccessError(req.auth, agent);
    if (accessError) return reply.status(403).send(accessError);

    const body = req.body as Record<string, unknown>;
    if (!body['claim'] || typeof body['claim'] !== 'string') {
      return reply
        .status(400)
        .send({ error: 'ValidationError', message: 'claim is required' });
    }
    if (!body['issuerMerchantId'] || typeof body['issuerMerchantId'] !== 'string') {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'issuerMerchantId is required',
      });
    }

    const attestation: Attestation = {
      id: uuidv4(),
      subjectAgentId: req.params.id,
      issuerAgentId: body['issuerAgentId'] as string | undefined,
      issuerMerchantId: body['issuerMerchantId'] as string,
      claim: body['claim'] as string,
      data: (body['data'] as Record<string, unknown>) ?? {},
      expiresAt: body['expiresAt'] as string | undefined,
      createdAt: new Date().toISOString(),
    };

    await setAttestation(attestation);
    app.log.info(
      { attestationId: attestation.id, subjectAgentId: req.params.id },
      '[agent-identity] Attestation added'
    );
    return reply.status(201).send({ data: attestation });
  });

  // ── GET /v1/agents/:id/attestations — List attestations ──────────────
  app.get<{ Params: { id: string } }>('/v1/agents/:id/attestations', async (req, reply) => {
    const agent = await getAgent(req.params.id);
    if (!agent) {
      return reply
        .status(404)
        .send({ error: 'NotFound', message: `Agent ${req.params.id} not found` });
    }
    const accessError = agentAccessError(req.auth, agent);
    if (accessError) return reply.status(403).send(accessError);
    const attestations = await getAttestationsBySubjectAgentId(req.params.id);
    return reply.send({ data: attestations, total: attestations.length });
  });

  // ── GET /v1/discover — Discover agents by capability ─────────────────
  app.get<{ Querystring: Record<string, string> }>('/v1/discover', async (req, reply) => {
    const { capability, minReputation, limit, framework } = req.query;

    if (!capability) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'capability query param is required',
      });
    }

    const agents = await listAgents({
      capability,
      framework: framework as AgentIdentity['framework'] | undefined,
      minReputation: minReputation ? Number(minReputation) : undefined,
      limit: limit ? Math.min(Number(limit), 100) : 20,
    });

    const discoveries = agents.map((a) => ({
      agentId: a.id,
      did: a.did,
      name: a.name,
      framework: a.framework,
      capabilities: a.capabilities,
      trustLevel: a.trustLevel,
      reputationScore: a.reputationScore,
      successRate: a.successRate,
      tags: a.tags,
      webhookUrl: a.webhookUrl,
    }));

    return reply.send({ data: discoveries, total: discoveries.length });
  });

  // ── POST /v1/verify-signature — Verify Ed25519 signature ─────────────
  app.post('/v1/verify-signature', async (req, reply) => {
    const body = req.body as Record<string, unknown>;

    if (!body['agentId'] || !body['message'] || !body['signature']) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'agentId, message, and signature are required',
      });
    }

    const agent = await getAgent(body['agentId'] as string);
    if (!agent) {
      return reply
        .status(404)
        .send({ error: 'NotFound', message: `Agent ${body['agentId']} not found` });
    }
    if (!agent.publicKey) {
      return reply.status(422).send({
        error: 'UnprocessableEntity',
        message: 'Agent has no public key registered',
      });
    }

    try {
      const verify = createVerify('ed25519');
      verify.update(body['message'] as string);
      const isValid = verify.verify(
        { key: Buffer.from(agent.publicKey, 'hex'), format: 'der', type: 'spki' },
        Buffer.from(body['signature'] as string, 'hex')
      );
      return reply.send({ valid: isValid, agentId: agent.id, did: agent.did });
    } catch (err) {
      app.log.warn(
        { err, agentId: agent.id },
        '[agent-identity] Signature verification error'
      );
      return reply.send({
        valid: false,
        agentId: agent.id,
        did: agent.did,
        error: 'Signature verification failed',
      });
    }
  });

  // ── Error handlers ─────────────────────────────────────────────────────
  app.setErrorHandler<FastifyError>((err, req, reply) => {
    req.log.error({ err, url: req.url }, 'Unhandled request error');
    const isDev = process.env['NODE_ENV'] !== 'production';
    reply.status(err.statusCode ?? 500).send({
      error: err.name ?? 'InternalServerError',
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

// ── Startup ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await initStore();

  const app = await buildApp();

  const shutdown = async () => {
    app.log.info('[agent-identity] Shutting down...');
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
║          ForgePay Agent Identity Registry                    ║
║          Listening on port ${PORT}                              ║
║                                                              ║
║  Register Agent   →  POST /v1/agents                         ║
║  Discover Agents  →  GET  /v1/discover?capability=payment    ║
║  Reputation       →  POST /v1/agents/:id/reputation          ║
║  Attestations     →  GET  /v1/agents/:id/attestations        ║
║  Verify Signature →  POST /v1/verify-signature               ║
╚══════════════════════════════════════════════════════════════╝
`);
}

// Only auto-start when this module is the actual process entrypoint (e.g.
// `node dist/index.js`) — not when it's `import`ed for `buildApp` (as the
// test suite does), which would otherwise start a second real listener on
// the same port as a side effect of merely importing the module.
if (require.main === module) {
  main().catch((err) => {
    console.error('[agent-identity] Fatal startup error:', err);
    process.exit(1);
  });
}

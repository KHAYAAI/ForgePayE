/**
 * FORGE Custody — institutional digital-asset custody & threshold signing.
 * (OpenFireblocks, integrated into the FORGE ecosystem.)
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: signs institutional-size transfers (>$1M routed here by FORGE
 *       Payments) behind a per-workspace policy engine and 4-of-7 MPC
 *       threshold signatures. No single keyholder exists.
 *
 * Pipeline: POST /api/v1/sign → policy evaluation → (multi-party approval)
 *           → threshold signing → broadcast → 12-block confirmation →
 *           `custody.signature.confirmed` event to the Revenue Ontology.
 *
 * Port: 3019
 *
 * Env vars:
 *   PORT                    — default 3019
 *   DATABASE_URL            — Postgres (schema forge_custody)
 *   MPC_COORDINATOR_URL     — Go MPC orchestrator; REQUIRED in production
 *   BLOCKCHAIN_RPC_URL      — optional; simulated settlement when unset
 *   COMPLIANCE_MONITOR_URL  — optional sanctions screening endpoint
 *   UNIFIED_ROUTER_URL      — revenue-ontology webhook target
 *   WEBHOOK_SECRET          — HMAC secret for ontology events; REQUIRED in production
 *   CORS_ORIGIN             — default: none (server-to-server API)
 *   RATE_LIMIT_PER_MIN      — default 300
 *   LOG_LEVEL               — default info
 */

import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { runMigrations } from './db';
import { authenticate } from './auth';
import { evaluatePolicies } from './policy';
import { executeSigning } from './signer';
import { logger } from './lib/logger';
import { getMetrics, signingRequestsTotal } from './lib/metrics';
import { instrumentationPlugin } from './lib/instrumentation';
import {
  addApproval,
  audit,
  auditLog,
  createKey,
  createPolicy,
  createWorkspace,
  issueApiKey,
  newId,
  policiesForWorkspace,
  recordCeremony,
  saveSigningRequest,
  signingApprovals,
  signingRequests,
} from './store';
import type { SigningRequest } from './types';

const PORT = Number(process.env.PORT ?? 3019);

function requireProductionSecrets(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const missing = ['WEBHOOK_SECRET', 'MPC_COORDINATOR_URL', 'DATABASE_URL'].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    throw new Error(`[custody] refusing to start in production without: ${missing.join(', ')}`);
  }
}

export async function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 512 * 1024 });

  await app.register(helmet);
  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin) {
    await app.register(cors, { origin: corsOrigin.split(',') });
  }
  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_PER_MIN ?? 300),
    timeWindow: '1 minute',
  });
  await app.register(instrumentationPlugin);

  // ── Health & metrics ────────────────────────────────────────────────────────
  app.get('/api/health', async () => ({ status: 'ok', service: 'forge-custody' }));
  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', 'text/plain');
    return getMetrics();
  });

  // ── Workspace bootstrap (operator-only in production deployments; the
  //    ingress layer restricts this route to the internal network) ─────────────
  const bootstrapSchema = z.object({
    name: z.string().min(2).max(120),
    institutionType: z.enum(['bank', 'fintech', 'fund', 'enterprise', 'other']).default('bank'),
  });

  app.post('/api/v1/workspaces', async (req, reply) => {
    const parsed = bootstrapSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.flatten() });
    const ws = createWorkspace(parsed.data.name, parsed.data.institutionType);
    const { rawKey, record } = issueApiKey(ws.id, 'default');
    audit({
      workspaceId: ws.id, apiKeyId: record.id, actor: 'operator', method: 'POST',
      path: req.url, action: 'workspace.create', resourceId: ws.id, statusCode: 201, detail: null,
      ip: req.ip,
    });
    // rawKey is returned exactly once and never stored.
    return reply.code(201).send({ workspace: ws, api_key: rawKey });
  });

  // ── Authenticated routes ────────────────────────────────────────────────────
  const withAuth = async (req: FastifyRequest, reply: FastifyReply) => authenticate(req, reply);

  const policySchema = z.object({
    name: z.string().min(1).max(120),
    rules: z.object({
      dailyLimitUsd: z.number().positive().optional(),
      whitelist: z.array(z.string().min(4)).max(10_000).optional(),
      timeWindow: z
        .object({
          days: z.array(z.number().int().min(0).max(6)).min(1),
          startHour: z.number().int().min(0).max(23),
          endHour: z.number().int().min(1).max(24),
        })
        .optional(),
      approvalThreshold: z
        .object({
          amountUsd: z.number().positive(),
          approvalsRequired: z.number().int().min(1).max(10),
          roles: z.array(z.string()).optional(),
        })
        .optional(),
      allowedChains: z.array(z.string()).optional(),
    }),
  });

  app.post('/api/v1/policies', async (req, reply) => {
    const auth = await withAuth(req, reply);
    if (!auth) return;
    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.flatten() });
    const policy = createPolicy(auth.workspace.id, parsed.data.name, parsed.data.rules);
    audit({
      workspaceId: auth.workspace.id, apiKeyId: auth.apiKey.id, actor: auth.apiKey.name,
      method: 'POST', path: req.url, action: 'policy.create', resourceId: policy.id,
      statusCode: 201, detail: { name: policy.name }, ip: req.ip,
    });
    return reply.code(201).send(policy);
  });

  app.get('/api/v1/policies', async (req, reply) => {
    const auth = await withAuth(req, reply);
    if (!auth) return;
    return policiesForWorkspace(auth.workspace.id);
  });

  const keySchema = z.object({
    blockchain: z.string().min(2),
    publicKey: z.string().min(8),
    address: z.string().min(4),
    totalShares: z.number().int().min(3).max(15).default(7),
    threshold: z.number().int().min(2).max(15).default(4),
    shareHolders: z.array(z.string()).default([]),
    vaultPath: z.string().min(4),
  });

  app.post('/api/v1/keys', async (req, reply) => {
    const auth = await withAuth(req, reply);
    if (!auth) return;
    const parsed = keySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.flatten() });
    if (parsed.data.threshold > parsed.data.totalShares) {
      return reply.code(400).send({ error: 'invalid_request', detail: 'threshold cannot exceed totalShares' });
    }
    const key = createKey({ ...parsed.data, workspaceId: auth.workspace.id });
    audit({
      workspaceId: auth.workspace.id, apiKeyId: auth.apiKey.id, actor: auth.apiKey.name,
      method: 'POST', path: req.url, action: 'key.create', resourceId: key.id,
      statusCode: 201, detail: { blockchain: key.blockchain, threshold: `${key.threshold}-of-${key.totalShares}` },
      ip: req.ip,
    });
    return reply.code(201).send(key);
  });

  const ceremonySchema = z.object({
    participants: z.array(z.object({ participantId: z.string(), role: z.string().optional() })).min(3),
    vssCommitments: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(3),
    keyId: z.string().nullable().default(null),
  });

  app.post('/api/v1/ceremonies', async (req, reply) => {
    const auth = await withAuth(req, reply);
    if (!auth) return;
    const parsed = ceremonySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.flatten() });
    const ceremony = recordCeremony({
      workspaceId: auth.workspace.id,
      ceremonyType: 'dkg',
      participants: parsed.data.participants,
      vssCommitments: parsed.data.vssCommitments,
      commitmentsVerified: parsed.data.vssCommitments.length === parsed.data.participants.length,
      keyId: parsed.data.keyId,
    });
    audit({
      workspaceId: auth.workspace.id, apiKeyId: auth.apiKey.id, actor: auth.apiKey.name,
      method: 'POST', path: req.url, action: 'ceremony.record', resourceId: ceremony.id,
      statusCode: 201, detail: { participants: ceremony.participants.length }, ip: req.ip,
    });
    return reply.code(201).send(ceremony);
  });

  // ── Signing ─────────────────────────────────────────────────────────────────
  const signSchema = z.object({
    customer_id: z.string().min(1),
    key_id: z.string().min(1),
    blockchain: z.string().min(2),
    amount_usd: z.number().nonnegative().default(0),
    transaction: z.object({
      to: z.string().min(4),
      data: z.string().optional(),
      value: z.string().regex(/^\d+$/),
      gas: z.string().optional(),
      gasPrice: z.string().optional(),
    }),
    metadata: z.record(z.unknown()).default({}),
  });

  app.post('/api/v1/sign', async (req, reply) => {
    const auth = await withAuth(req, reply);
    if (!auth) return;
    const parsed = signSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.flatten() });
    const input = parsed.data;

    const request: SigningRequest = {
      id: newId('sr'),
      workspaceId: auth.workspace.id,
      customerId: input.customer_id,
      keyId: input.key_id,
      blockchain: input.blockchain,
      transaction: input.transaction,
      metadata: input.metadata,
      amountUsd: input.amount_usd,
      status: 'pending_policy',
      reasonCode: null,
      approvalsRequired: 0,
      approverRoles: [],
      signature: null,
      txHash: null,
      blockNumber: null,
      confirmationTime: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveSigningRequest(request);

    const decision = await evaluatePolicies({
      workspaceId: auth.workspace.id,
      keyId: input.key_id,
      blockchain: input.blockchain,
      amountUsd: input.amount_usd,
      transaction: input.transaction,
      metadata: input.metadata,
    });

    if (!decision.allowed) {
      request.status = 'rejected';
      request.reasonCode = decision.reasonCode ?? null;
      saveSigningRequest(request);
      signingRequestsTotal.inc({ status: 'rejected' });
      audit({
        workspaceId: auth.workspace.id, apiKeyId: auth.apiKey.id, actor: auth.apiKey.name,
        method: 'POST', path: req.url, action: 'signing.reject', resourceId: request.id,
        statusCode: 200, detail: { reason: decision.reasonCode }, ip: req.ip,
      });
      return reply.send({ signing_id: request.id, status: request.status, reason_code: request.reasonCode });
    }

    audit({
      workspaceId: auth.workspace.id, apiKeyId: auth.apiKey.id, actor: auth.apiKey.name,
      method: 'POST', path: req.url, action: 'signing.create', resourceId: request.id,
      statusCode: 201, detail: { amountUsd: request.amountUsd, chain: request.blockchain }, ip: req.ip,
    });

    if (decision.requiresApproval) {
      request.status = 'pending_approval';
      request.approvalsRequired = decision.approvalsRequired ?? 1;
      request.approverRoles = decision.approverRoles ?? [];
      saveSigningRequest(request);
      signingRequestsTotal.inc({ status: 'pending_approval' });
      return reply.code(201).send({
        signing_id: request.id,
        status: request.status,
        approvals_required: request.approvalsRequired,
        approver_roles: request.approverRoles,
      });
    }

    request.status = 'approved';
    saveSigningRequest(request);
    const result = await executeSigning(request);
    signingRequestsTotal.inc({ status: result.status });
    return reply.code(201).send({
      signing_id: result.id,
      status: result.status,
      tx_hash: result.txHash,
      confirmation_time: result.confirmationTime,
      block_number: result.blockNumber,
    });
  });

  const approveSchema = z.object({
    approver_id: z.string().min(1),
    approver_role: z.string().min(1),
  });

  app.post('/api/v1/signing/:id/approve', async (req, reply) => {
    const auth = await withAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.flatten() });

    const request = signingRequests.get(id);
    if (!request || request.workspaceId !== auth.workspace.id) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (request.status !== 'pending_approval') {
      return reply.code(409).send({ error: 'invalid_state', status: request.status });
    }

    const existing = signingApprovals.get(id) ?? [];
    if (existing.some((a) => a.approverId === parsed.data.approver_id)) {
      return reply.code(409).send({ error: 'duplicate_approver' });
    }
    if (request.approverRoles.length > 0 && !request.approverRoles.includes(parsed.data.approver_role)) {
      return reply.code(403).send({ error: 'role_not_permitted', allowed: request.approverRoles });
    }
    if (
      request.approverRoles.length > 0 &&
      existing.some((a) => a.approverRole === parsed.data.approver_role)
    ) {
      return reply.code(409).send({ error: 'role_already_approved' });
    }

    addApproval({
      id: newId('apr'),
      signingRequestId: id,
      approverId: parsed.data.approver_id,
      approverRole: parsed.data.approver_role,
      approvedAt: new Date().toISOString(),
    });
    audit({
      workspaceId: auth.workspace.id, apiKeyId: auth.apiKey.id, actor: parsed.data.approver_id,
      method: 'POST', path: req.url, action: 'signing.approve', resourceId: id,
      statusCode: 200, detail: { role: parsed.data.approver_role }, ip: req.ip,
    });

    const count = (signingApprovals.get(id) ?? []).length;
    if (count < request.approvalsRequired) {
      return reply.send({ signing_id: id, status: request.status, approvals: count, approvals_required: request.approvalsRequired });
    }

    request.status = 'approved';
    saveSigningRequest(request);
    const result = await executeSigning(request);
    signingRequestsTotal.inc({ status: result.status });
    return reply.send({
      signing_id: result.id,
      status: result.status,
      tx_hash: result.txHash,
      confirmation_time: result.confirmationTime,
      block_number: result.blockNumber,
    });
  });

  app.get('/api/v1/signing/:id', async (req, reply) => {
    const auth = await withAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const request = signingRequests.get(id);
    if (!request || request.workspaceId !== auth.workspace.id) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return {
      signing_id: request.id,
      status: request.status,
      reason_code: request.reasonCode,
      approvals: (signingApprovals.get(id) ?? []).length,
      approvals_required: request.approvalsRequired,
      tx_hash: request.txHash,
      block_number: request.blockNumber,
      confirmation_time: request.confirmationTime,
      error: request.error,
    };
  });

  app.get('/api/v1/audit', async (req, reply) => {
    const auth = await withAuth(req, reply);
    if (!auth) return;
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 100), 500);
    return auditLog
      .filter((entry) => entry.workspaceId === auth.workspace.id)
      .slice(-limit)
      .reverse();
  });

  return app;
}

async function main(): Promise<void> {
  requireProductionSecrets();
  try {
    await runMigrations();
  } catch (err) {
    if (process.env.NODE_ENV === 'production') throw err;
    logger.warn({ err }, '[custody] Postgres unavailable — running in-memory only (dev)');
  }
  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info({ port: PORT }, '[custody] FORGE Custody listening');
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, '[custody] fatal startup error');
    process.exit(1);
  });
}

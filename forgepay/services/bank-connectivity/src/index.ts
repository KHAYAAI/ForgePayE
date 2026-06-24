/**
 * ForgePay Bank Connectivity Service
 * ────────────────────────────────────────────────────────────────────────────
 * Provides:
 *   - Plaid integration (US bank accounts — ACH / transactions / balances)
 *   - Open Banking adapter (EU/UK — SEPA / accounts / balances / transactions)
 *   - Secure access-token storage (AES-256-GCM)
 *   - Transfer initiation and status tracking
 *
 * Port: 3006  (set via PORT env var)
 *
 * Route prefixes:
 *   /api/v1/link/plaid/*        Plaid Link flow
 *   /api/v1/accounts/*          Account management
 *   /api/v1/transfers/*         Transfer initiation and status
 *   /webhooks/plaid             Plaid event notifications
 *   /webhooks/openbanking       Open Banking event notifications
 *   /healthz                    Liveness probe
 *   /readyz                     Readiness probe
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import { buildAccountRoutes } from './routes/accounts';
import { buildTransferRoutes } from './routes/transfers';
import { buildWebhookRoutes } from './routes/webhooks';
import { buildInternalRoutes } from './routes/internal';
import { logger } from './lib/logger';

export const prisma = new PrismaClient();

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT ?? '3006', 10);

  const app = Fastify({
    logger:          false,         // pino logger used directly
    trustProxy:      true,
    requestIdHeader: 'x-request-id',
    genReqId:        () => crypto.randomUUID(),
    // Enable rawBody so webhook handlers can verify signatures
    // over the unmodified request buffer.
    bodyLimit:       1_048_576,     // 1 MB
  });

  // ── Add rawBody support for webhook signature verification ────────────────
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body: Buffer, done) => {
      try {
        // Attach raw buffer before JSON parsing so webhook routes can verify sigs
        (req as typeof req & { rawBody: Buffer }).rawBody = body;
        const json = JSON.parse(body.toString('utf8')) as unknown;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // ── Security plugins ──────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false,   // API service — no HTML responses
  });

  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

  await app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    credentials: true,
  });

  await app.register(rateLimit, {
    max:         100,
    timeWindow:  '1 minute',
    keyGenerator: (req) => req.headers['x-merchant-id'] as string ?? req.ip,
  });

  // ── JWT plugin ────────────────────────────────────────────────────────────
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    logger.error('JWT_SECRET env var is not set — refusing to start');
    process.exit(1);
  }

  await app.register(jwt, {
    secret: jwtSecret,
  });

  // ── Health routes ─────────────────────────────────────────────────────────
  app.get('/healthz', async (_req, reply) => {
    return reply.code(200).send({ status: 'ok' });
  });

  app.get('/readyz', async (_req, reply) => {
    // Add dependency checks (DB connectivity, Plaid reachability) here in production
    return reply.code(200).send({ status: 'ready' });
  });

  // ── API routes ────────────────────────────────────────────────────────────
  await app.register(buildAccountRoutes, { prefix: '/api/v1' });
  await app.register(buildTransferRoutes, { prefix: '/api/v1' });

  // ── Internal settlement routes — service-to-service, x-source auth ────────
  await app.register(buildInternalRoutes);

  // ── Webhook routes (no JWT auth — use HMAC signature verification instead) ─
  await app.register(buildWebhookRoutes, { prefix: '/webhooks' });

  // ── Global error handler ──────────────────────────────────────────────────
  app.setErrorHandler((err, req, reply) => {
    logger.error(
      { err, requestId: req.id, method: req.method, url: req.url },
      'Unhandled error',
    );

    const statusCode = err.statusCode ?? 500;
    return reply.code(statusCode).send({
      statusCode,
      error:   statusCode >= 500 ? 'Internal Server Error' : err.name,
      message: statusCode >= 500 ? 'An unexpected error occurred' : err.message,
      requestId: req.id,
    });
  });

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.setNotFoundHandler((req, reply) => {
    return reply.code(404).send({
      statusCode: 404,
      error:   'Not Found',
      message: `Route ${req.method} ${req.url} not found`,
    });
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down bank-connectivity service');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  // ── Connect Prisma ────────────────────────────────────────────────────────
  await prisma.$connect();
  app.log.info('[bank-connectivity] Prisma connected to PostgreSQL');

  // ── Run migrations ────────────────────────────────────────────────────────
  try {
    execSync('prisma migrate deploy', { stdio: 'inherit', cwd: process.cwd() });
    app.log.info('[bank-connectivity] Database migrations completed');
  } catch (err) {
    logger.warn('[bank-connectivity] Migrations error (may be already applied):', err instanceof Error ? err.message : String(err));
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'ForgePay bank-connectivity service started');
}

main().catch((err: unknown) => {
  logger.error(err, 'Fatal startup error');
  process.exit(1);
});

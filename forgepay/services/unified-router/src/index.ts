/**
 * ARCH: ForgePay Unified Router
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: The internal event bus. Every sub-service posts its raw webhook here.
 * This service normalises all events to the canonical `ForgePayEvent` schema and
 * fans them out to merchants. It is the SINGLE SOURCE OF TRUTH for all platform
 * events — the dashboard, SDK, and merchant webhooks all read from here.
 *
 * Inbound sources (POST /webhooks/<source>):
 *   payment-engine  → /webhooks/hyperswitch   (Hyperswitch Rust router)
 *   billing-engine  → /webhooks/killbill      (Kill Bill Java)
 *   stablecoin-gw   → /webhooks/stablecoin    (USDC/USDT + x402 — port 8020)
 *   crypto-gw       → /webhooks/crypto        (BTC/ETH/LTC/XMR invoices — port 8030)
 *
 * Outbound (async fan-out):
 *   → merchant webhook endpoints in DB (POST with HMAC-SHA256 signed payload)
 *   → forgepay_events table in Postgres (permanent event log)
 *
 * Per-event pipeline:
 *   1. Verify HMAC-SHA256 signature (lib/crypto.ts)
 *   2. Deduplicate via Redis with 7-day TTL (lib/dedup.ts)
 *   3. Normalise to ForgePayEvent (normalizers/*.ts)
 *   4. Persist to Postgres (routes/webhooks.ts → persistEvent)
 *   5. Fan-out to merchant endpoints (lib/dispatch.ts)
 *        Queries merchant_webhook_endpoints, POSTs signed payloads with retry.
 *
 * Outbound query API (GET /events):
 *   Serves the dashboard and the SDK events resource.
 *   Auth: Bearer token (internal secret or merchant signing_secret from DB).
 *
 * Ports:
 *   HTTP  :8000  (primary — all routes)
 *   Metrics :9090 /metrics (Prometheus scrape, via OTel Collector)
 *   Health  :8000 /healthz /readyz
 */

import Fastify, { FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { buildWebhookRoutes } from './routes/webhooks.js';
import { buildPaymentRoutes } from './routes/payments.js';
import { buildEventRoutes } from './routes/events.js';
import { buildHealthRoutes } from './routes/health.js';
import { customerRoutes } from './routes/customer.js';
import { bundleRoutes } from './routes/bundle.js';
import { csmRoutes } from './routes/csm.js';
import { registerAuth } from './auth.js';
import { createRedisClient } from './lib/redis.js';
import { pool as sharedPool } from './db/index.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';

async function main() {
  const app = Fastify({
    logger: false, // we use pino directly
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 5 * 1024 * 1024, // 5MB — generous ceiling for webhook payloads
  });

  // ── Raw body capture ──────────────────────────────────────────────────────
  // webhooks.ts verifies each source's HMAC signature over the *exact* bytes
  // received (verifyHmacSignature reads `req.rawBody`). Fastify's default
  // JSON parser discards the raw buffer after parsing, so without this the
  // buffer is always undefined and every webhook is rejected as
  // "missing_signature" — this parser is what makes that verification real.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body: Buffer, done) => {
      (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body;
      if (body.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // ── Security ──────────────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false, // API-only service, no HTML
  });

  await app.register(rateLimit, {
    max:    1000,
    timeWindow: '1 minute',
    // Per-source rate limiting: internal services get higher limits
    keyGenerator: (req) => req.headers['x-forgepay-source'] as string ?? req.ip,
  });

  // ── Shared resources ──────────────────────────────────────────────────────
  const redis = createRedisClient(config.redis.url);
  const db    = sharedPool; // same pool ../db's tenant-scoped wrapper uses — one pool per process

  // Decorate so routes can access them
  app.decorate('redis', redis);
  app.decorate('db',    db);

  // Run DB migrations before accepting traffic — without this, a fresh
  // Postgres database has none of the tables this service queries/writes
  // (forgepay_events, dedup, etc.).
  try {
    const { runMigrations } = await import('./db/migrate.js');
    await runMigrations(db);
  } catch (err) {
    if (config.env === 'production') throw err;
    logger.warn({ err }, '[unified-router] Migrations failed — continuing (dev only)');
  }

  // ── Authentication ────────────────────────────────────────────────────────
  // Registered before the routes so `request.user` is populated by the time any
  // handler runs. Deny-by-default: an unlisted route requires the operator key.
  await registerAuth(app);

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(buildHealthRoutes);
  await app.register(buildWebhookRoutes, { prefix: '/webhooks' });
  await app.register(buildPaymentRoutes);
  await app.register(buildEventRoutes,   { prefix: '/events' });

  // Product licensing. These four modules existed but were never registered
  // because they read `request.user` and nothing populated it — see auth.ts.
  await app.register(customerRoutes);
  await app.register(bundleRoutes, { prefix: '/bundle' });
  await app.register(csmRoutes,    { prefix: '/csm' });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down unified-router');
    await app.close();
    await redis.quit();
    await db.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // ── Global error handlers (prevent silent pod crashes) ────────────────
  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled Rejection');
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    logger.error({ error }, 'Uncaught Exception');
    process.exit(1);
  });

  // ── Start ─────────────────────────────────────────────────────────────────
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port }, 'ForgePay unified-router started');
}

main().catch((err) => {
  logger.error(err, 'Fatal startup error');
  process.exit(1);
});

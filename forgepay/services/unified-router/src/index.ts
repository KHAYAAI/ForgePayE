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

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { buildWebhookRoutes } from './routes/webhooks.js';
import { buildEventRoutes } from './routes/events.js';
import { buildHealthRoutes } from './routes/health.js';
import { createRedisClient } from './lib/redis.js';
import { createDbPool } from './lib/db.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';

async function main() {
  const app = Fastify({
    logger: false, // we use pino directly
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

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
  const db    = createDbPool(config.postgres);

  // Decorate so routes can access them
  app.decorate('redis', redis);
  app.decorate('db',    db);

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(buildHealthRoutes);
  await app.register(buildWebhookRoutes, { prefix: '/webhooks' });
  await app.register(buildEventRoutes,   { prefix: '/events' });

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

  // ── Start ─────────────────────────────────────────────────────────────────
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port }, 'ForgePay unified-router started');
}

main().catch((err) => {
  logger.error(err, 'Fatal startup error');
  process.exit(1);
});

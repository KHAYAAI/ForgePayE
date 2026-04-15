/**
 * ForgePay Unified Router
 *
 * Normalizes webhooks and events from all payment sub-services into a single
 * canonical ForgePay event stream, then fans them out to merchant webhooks.
 *
 * Services handled:
 *   - payment-engine  (Hyperswitch)
 *   - billing-engine  (Kill Bill)
 *   - mor-layer       (Polar fork)
 *   - stablecoin-gw   (ZeroPay fork)
 *   - crypto-gw       (Keagate fork)
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

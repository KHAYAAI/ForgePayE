/**
 * ARCH: ForgePay Bank White-Label Module
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Multi-tenant bank admin console for ForgePay.
 *
 * Banks (e.g. Investec, Discovery) get an isolated namespace:
 *   - Their own admin logins (JWT, separate from merchant auth)
 *   - Their own customer registry with daily spending limits
 *   - Full transaction history scoped to their bankId
 *   - Daily settlement reports (JSON + CSV)
 *   - Webhook forwarding in forgepay / ISO 20022 / custom format
 *   - KYC status change webhooks
 *   - Admin action audit log
 *
 * Port: 3015
 *
 * Auth: POST /v1/auth/login → JWT { adminId, bankId, role }
 * Passwords hashed with scrypt (N=16384) — replaces insecure SHA-256.
 */

import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';

import { registerAuthRoutes } from './auth.js';
import { registerBankRoutes } from './routes/banks.js';
import { registerCustomerRoutes } from './routes/customers.js';
import { registerTransactionRoutes } from './routes/transactions.js';
import { registerSettlementRoutes } from './routes/settlement.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerAuditRoutes } from './audit.js';
import { Admins, Banks, hashPassword } from './store.js';
import { randomUUID } from 'node:crypto';

const PORT         = parseInt(process.env['PORT'] ?? '3015', 10);
const JWT_SECRET   = process.env['JWT_SECRET'] ?? 'forgepay_bank_jwt_secret_dev';
const NODE_ENV     = process.env['NODE_ENV'] ?? 'development';
const CORS_ORIGINS = process.env['CORS_ORIGINS']?.split(',') ?? ['*'];

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      ...(NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }),
    },
    trustProxy: true,
  });

  // ── Plugins ───────────────────────────────────────────────────────────────

  await app.register(helmet, {
    contentSecurityPolicy: false, // API service — no HTML pages
  });

  await app.register(cors, {
    origin:      CORS_ORIGINS,
    methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await app.register(rateLimit, {
    max:        200,
    timeWindow: '1 minute',
    keyGenerator: (req) =>
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error:      'Too Many Requests',
      message:    `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });

  await app.register(jwt, { secret: JWT_SECRET });

  // ── Health check ──────────────────────────────────────────────────────────

  app.get('/health', async () => ({
    status:    'ok',
    service:   'bank-whitelabel',
    version:   '0.2.0',
    timestamp: new Date().toISOString(),
  }));

  // ── Metrics ───────────────────────────────────────────────────────────────

  app.get('/metrics', async (_req, reply) => {
    const { register } = await import('./lib/metrics.js');
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(await register.metrics());
  });

  // ── Routes ────────────────────────────────────────────────────────────────

  await registerAuthRoutes(app);
  await registerBankRoutes(app);
  await registerCustomerRoutes(app);
  await registerTransactionRoutes(app);
  await registerSettlementRoutes(app);
  await registerWebhookRoutes(app);
  await registerAuditRoutes(app);

  // ── Error handlers ────────────────────────────────────────────────────────

  app.setErrorHandler<FastifyError>((err, req, reply) => {
    req.log.error({ err, url: req.url }, 'Unhandled request error');
    const isDev = NODE_ENV !== 'production';
    reply.status(err.statusCode ?? 500).send({
      error:   err.name ?? 'InternalServerError',
      message: err.message,
      ...(isDev && err.stack ? { stack: err.stack } : {}),
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: 'NotFound', path: req.url });
  });

  // ── Startup seed ──────────────────────────────────────────────────────────
  // Create the default Investec admin on first boot so the service is immediately usable.
  // Gate behind SEED_ON_STARTUP=true in production.

  if (Admins.count() === 0 && (process.env['SEED_ON_STARTUP'] !== 'false')) {
    const investecBank = Banks.findById('investec');
    if (investecBank) {
      Admins.create({
        id:           randomUUID(),
        bankId:       'investec',
        email:        'admin@investec.com',
        passwordHash: hashPassword('investec123'),
        role:         'admin',
        createdAt:    new Date().toISOString(),
      });
      app.log.info('[bank-whitelabel] Seeded default Investec admin: admin@investec.com / investec123');
    }
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  const shutdown = async () => {
    app.log.info('[bank-whitelabel] Shutting down gracefully...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`[bank-whitelabel] Listening on :${PORT} (${NODE_ENV})`);
}

main().catch((err) => {
  console.error('[bank-whitelabel] Fatal startup error:', err);
  process.exit(1);
});

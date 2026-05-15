/**
 * ARCH: ForgePay Bank White-Label Module
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Multi-tenant bank admin console for ForgePay.
 *
 * Banks (e.g. Investec, Discovery) get an isolated namespace:
 *   - Their own admin logins (JWT, separate from merchant auth)
 *   - Their own customer registry (end-users using the bank's crypto service)
 *   - Full transaction history scoped to their bankId
 *   - Daily settlement reports (JSON + CSV)
 *   - Webhook forwarding to the bank's endpoint in their expected format
 *
 * Multi-tenant isolation:
 *   Every protected route reads bankId from the JWT and scopes all DB queries
 *   to that bankId. Bank A cannot access Bank B's data.
 *
 * Port: 3015
 *
 * Auth flow:
 *   POST /v1/auth/login  → JWT { adminId, bankId, role }
 *   Include JWT in Authorization: Bearer <token> header on all other requests.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';

import { registerAuthRoutes } from './auth.js';
import { registerBankRoutes } from './routes/banks.js';
import { registerCustomerRoutes } from './routes/customers.js';
import { registerTransactionRoutes } from './routes/transactions.js';
import { registerSettlementRoutes } from './routes/settlement.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
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

  await app.register(cors, {
    origin:      CORS_ORIGINS,
    methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await app.register(rateLimit, {
    max:        200,
    timeWindow: '1 minute',
    keyGenerator: (req) =>
      (req.headers['x-forwarded-for'] as string) ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error:      'Too Many Requests',
      message:    `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });

  await app.register(jwt, {
    secret: JWT_SECRET,
  });

  // ── Health check (unprotected) ────────────────────────────────────────────

  app.get('/health', async () => ({
    status:    'ok',
    service:   'bank-whitelabel',
    timestamp: new Date().toISOString(),
    version:   '0.1.0',
  }));

  // ── Routes ────────────────────────────────────────────────────────────────

  await registerAuthRoutes(app);
  await registerBankRoutes(app);
  await registerCustomerRoutes(app);
  await registerTransactionRoutes(app);
  await registerSettlementRoutes(app);
  await registerWebhookRoutes(app);

  // ── Startup seed ──────────────────────────────────────────────────────────
  // Create the default Investec admin on first boot so the service is immediately usable.
  // In production: remove this or gate behind a SEED_ON_STARTUP env flag.

  if (Admins.count() === 0) {
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

  // ── Start listening ───────────────────────────────────────────────────────

  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`[bank-whitelabel] Listening on :${PORT} (${NODE_ENV})`);
}

main().catch((err) => {
  console.error('[bank-whitelabel] Fatal startup error:', err);
  process.exit(1);
});

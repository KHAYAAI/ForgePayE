/**
 * ARCH: ForgePay Crypto Gateway
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Accepts Bitcoin, Ethereum, Litecoin, and Monero (XMR) payments via an
 *   invoice model. Each invoice gets a unique deposit address. When the expected
 *   amount arrives and reaches the required confirmation depth, a canonical
 *   crypto.payment.confirmed event is emitted to the unified-router.
 *
 * Payment flow:
 *   Merchant calls POST /invoices → receive { address, coin, amount_crypto, expires_at }
 *   Customer sends crypto to the invoice address
 *   Chain monitor (to be implemented per-coin) detects the transaction
 *   After N confirmations → emit crypto.payment.confirmed to unified-router
 *   unified-router fans out to merchant webhook endpoints + SDK events log
 *
 * Supported coins:
 *   BTC  — Bitcoin       (P2WPKH bech32 address, bitcoinjs-lib)
 *   ETH  — Ethereum      (EOA address, ethers.js — reuses ETH from stablecoin-gateway)
 *   LTC  — Litecoin      (P2WPKH-LTC bech32 address)
 *   XMR  — Monero        (stealth address via Monero RPC)
 *
 * Ports: HTTP :8030
 *
 * Database tables required (run migration 003 before starting):
 *   crypto_invoices — one row per invoice
 */

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { config } from './config.js';
import { getDb } from './lib/db.js';
import { buildInvoiceRoutes } from './routes/invoices.js';
import { startChainMonitors } from './lib/monitor.js';
import { registerApiKeyAuth } from './plugins/api-key-auth.js';

async function main() {
  const app = Fastify({ logger: true, trustProxy: true });
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.headers['x-forwarded-for'] as string ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });

  await app.register(cors, {
    origin: config.corsAllowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false,
  });

  // Called directly (not via app.register) so a production misconfiguration
  // (missing/weak/placeholder VALID_API_KEYS) throws synchronously here,
  // failing startup rather than the first request.
  registerApiKeyAuth(app);

  const db = getDb();

  await app.register(buildInvoiceRoutes, { prefix: '/invoices' });

  // Start per-coin chain monitors after server is ready
  startChainMonitors(db);

  app.get('/healthz', async () => ({ status: 'ok', service: 'crypto-gateway' }));

  app.get('/metrics', async (_req, reply) => {
    const { register } = await import('./lib/metrics.js');
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(await register.metrics());
  });

  app.get('/readyz',  async () => {
    try {
      await db.query('SELECT 1', []);
      return { status: 'ready' };
    } catch (err) {
      return { status: 'not ready', error: String(err) };
    }
  });

  const shutdown = async () => {
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  // ── Global error handlers (prevent silent pod crashes) ────────────────
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[crypto-gateway] Unhandled Rejection:', reason, promise);
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    console.error('[crypto-gateway] Uncaught Exception:', error);
    process.exit(1);
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[crypto-gateway] Listening on :${config.port}`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

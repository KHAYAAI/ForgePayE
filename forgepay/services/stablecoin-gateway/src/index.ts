/**
 * ARCH: ForgePay Stablecoin Gateway
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Accepts USDC/USDT payments on EVM chains (Ethereum, Polygon, Base,
 *   Arbitrum) and Solana. Also implements the x402 micropayment protocol for
 *   AI/agent API access.
 *
 * Payment flow:
 *   Merchant calls POST /deposits → receive { address, chain, token, expires_at }
 *   Customer sends stablecoins to the deposit address
 *   Chain monitor (lib/monitor.ts) detects the Transfer event
 *   After N confirmations → emit stablecoin.payment.confirmed to unified-router
 *   unified-router fans out to merchant webhook endpoints
 *
 * x402 flow:
 *   Resource server returns GET /x402/payment-required → HTTP 402 with payment params
 *   AI agent calls POST /x402/pay → receive receipt_id
 *   Resource server calls GET /x402/verify/:receipt_id → { valid: true/false }
 *
 * Ports: HTTP :8020
 *
 * Database tables required (run migration before starting):
 *   stablecoin_deposits  — one row per deposit address
 *   x402_payments        — one row per x402 micropayment
 */

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { config } from './config.js';
import { getDb } from './lib/db.js';
import { startChainMonitor } from './lib/monitor.js';
import { buildDepositRoutes } from './routes/deposits.js';
import { buildX402Routes } from './routes/x402.js';
import { buildX402ShieldedRoutes } from './routes/x402-shielded.js';
import { buildShieldedDepositRoutes } from './routes/shielded-deposits.js';
import { startShieldedMonitor, startShieldedRecoveryPoller } from './lib/shielded-monitor.js';
import { assertShieldedPaymentsSafeToBoot } from './lib/proof-verifier.js';
import apiKeyAuth from './plugins/api-key-auth.js';

async function main() {
  // Fail fast, before we even bind a port, if shielded payments are enabled
  // in production without a real (deployed) proof-verification path. See
  // lib/proof-verifier.ts for details — this must never silently fall back
  // to the always-true stub in production.
  assertShieldedPaymentsSafeToBoot();

  const app = Fastify({ logger: true, trustProxy: true });
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(rateLimit, {
    max: 300,
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

  await app.register(apiKeyAuth);

  const db = getDb();

  // Register routes
  await app.register(buildDepositRoutes,         { prefix: '/deposits' });
  await app.register(buildX402Routes,            { prefix: '/x402' });

  // Shielded (ZK-proof) routes are gated behind SHIELDED_PAYMENTS_ENABLED.
  // verifyGroth16Proof() in lib/proof-verifier.ts is currently a stub that
  // always returns true outside of production, so until real Groth16
  // verification against a deployed NullifierRegistry is wired up, these
  // routes must default to NOT being registered at all — anyone could
  // otherwise POST garbage proof bytes and have them accepted as valid.
  if (config.shielded.paymentsEnabled) {
    await app.register(buildX402ShieldedRoutes,    { prefix: '/x402' });
    await app.register(buildShieldedDepositRoutes, { prefix: '/shielded-deposits' });
    console.warn(
      '[stablecoin-gateway] SHIELDED_PAYMENTS_ENABLED=true — shielded-deposits and ' +
      '/x402/shielded-pay routes are mounted. Verify verifyGroth16Proof() is backed by ' +
      'a deployed NullifierRegistry before accepting real traffic.',
    );
  } else {
    console.log(
      '[stablecoin-gateway] Shielded payment routes disabled ' +
      '(SHIELDED_PAYMENTS_ENABLED is unset/false) — /shielded-deposits and ' +
      '/x402/shielded-pay will 404.',
    );
  }

  // Health / readiness
  app.get('/healthz', async () => ({ status: 'ok', service: 'stablecoin-gateway' }));

  app.get('/metrics', async (_req, reply) => {
    const { register } = await import('./lib/metrics.js');
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(await register.metrics());
  });

  app.get('/readyz',  async () => {
    try {
      await db.query('SELECT 1', []);
      return { status: 'ready' };
    } catch (err) {
      const reply = app.server; // needed to set 503
      return { status: 'not ready', error: String(err) };
    }
  });

  // Start EVM chain monitors (fire-and-forget — don't block server startup)
  const chains = ['ethereum', 'polygon', 'base', 'arbitrum'] as const;
  for (const chain of chains) {
    startChainMonitor(chain, db).catch((err) =>
      console.error(`Chain monitor failed for ${chain}:`, err),
    );
  }

  // Start shielded-deposit monitors (only where NullifierRegistry is deployed)
  if (config.shielded.enabled) {
    for (const chain of chains) {
      startShieldedMonitor(chain, db).catch((err) =>
        console.error(`Shielded monitor failed for ${chain}:`, err),
      );
    }
    startShieldedRecoveryPoller(db);
    console.log('[stablecoin-gateway] Shielded payment monitoring enabled');
  } else {
    console.log('[stablecoin-gateway] Shielded payments disabled (SHIELDED_ENABLED=false)');
  }

  const shutdown = async () => {
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[stablecoin-gateway] Listening on :${config.port}`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

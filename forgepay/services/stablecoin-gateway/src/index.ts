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
import { config } from './config.js';
import { getDb } from './lib/db.js';
import { startChainMonitor } from './lib/monitor.js';
import { buildDepositRoutes } from './routes/deposits.js';
import { buildX402Routes } from './routes/x402.js';

async function main() {
  const app = Fastify({ logger: true, trustProxy: true });
  await app.register(helmet, { contentSecurityPolicy: false });

  const db = getDb();

  // Register routes
  await app.register(buildDepositRoutes, { prefix: '/deposits' });
  await app.register(buildX402Routes,    { prefix: '/x402' });

  // Health / readiness
  app.get('/healthz', async () => ({ status: 'ok', service: 'stablecoin-gateway' }));
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

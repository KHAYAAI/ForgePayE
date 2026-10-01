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

import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { config } from './config.js';
import { getDb } from './lib/db.js';
import { startSettlement } from './lib/settlement.js';
import { buildAlertRoutes } from './routes/alerts.js';
import { alerts } from './lib/alerts.js';
import { createFeedRunner, feedConfig, feedSourcesFromEnv, startFeed } from './lib/fx-feed.js';
import { startWatchdog } from './lib/watchdog.js';
import { createPgLeaderLock, leaderEnabled, type LeaderLock } from './lib/leader.js';
import { gatewayContext } from './lib/context.js';
import { buildAssetRoutes } from './routes/assets.js';
import { buildSweepRoutes } from './routes/sweeps.js';
import { buildTreasuryRoutes } from './routes/treasury.js';
import { treasuryRequested, resolveTreasuryConfig, createTreasuryManager, startTreasury } from './lib/treasury.js';
import { startPayoutWorker } from './lib/payout-worker.js';
import { resolveSweepConfig, sweepRequested, createSweeper, startSweeper } from './lib/sweeper.js';
import { assertKeystoreConfigured } from './lib/keystore.js';
import { buildDepositRoutes } from './routes/deposits.js';
import { buildX402Routes } from './routes/x402.js';
import { buildPayoutRoutes } from './routes/payouts.js';
import { buildX402ShieldedRoutes } from './routes/x402-shielded.js';
import { buildShieldedDepositRoutes } from './routes/shielded-deposits.js';
import { startShieldedMonitor, startShieldedRecoveryPoller } from './lib/shielded-monitor.js';
import { assertShieldedPaymentsSafeToBoot } from './lib/proof-verifier.js';
import apiKeyAuth from './plugins/api-key-auth.js';

/**
 * Assemble the Fastify app: plugins, auth, and routes. Split out from
 * main() so tests can build and `.inject()` against a real app (with real
 * auth/ownership enforcement) without starting chain monitors, binding a
 * port, or registering process signal handlers. Also means a production
 * misconfiguration (missing VALID_API_KEYS, unset/"*" CORS_ALLOWED_ORIGINS)
 * throws here, synchronously during boot, rather than on the first request.
 */
/**
 * How many reverse proxies sit in front of the gateway (TRUST_PROXY_HOPS, default 0). Only that many
 * X-Forwarded-For entries are believed. Trusting the header blindly lets any client pick its own rate-limit
 * key (and so evade the limit) by sending a different one on each request.
 */
export function trustedProxyHops(env: NodeJS.ProcessEnv = process.env): number | false {
  const n = Number(env['TRUST_PROXY_HOPS'] ?? 0);
  return Number.isInteger(n) && n > 0 ? n : false;
}

export async function buildApp() {
  const app = Fastify({ logger: true, trustProxy: trustedProxyHops() });
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip, // derived by Fastify from the trusted hops only; never the raw header
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

  // Registered before every route below so nothing is served without a
  // credential, and its own production misconfiguration (missing/weak/
  // placeholder VALID_API_KEYS) throws here rather than on the first request.
  await app.register(apiKeyAuth);

  // Register routes
  await app.register(buildDepositRoutes,         { prefix: '/deposits' });
  await app.register(buildX402Routes,            { prefix: '/x402' });

  // Which assets (USDC, USDT, ZARP, OUSD) are usable right now, and the rand rate.
  await app.register(buildAssetRoutes,           { prefix: '/assets' });

  // Moving paid-in funds from deposit addresses to the treasury (operator only).
  await app.register(buildSweepRoutes,           { prefix: '/sweeps' });

  // The payout wallet's float, topped up from the operating wallet within caps (operator view).
  await app.register(buildTreasuryRoutes,        { prefix: '/treasury' });
  await app.register(buildAlertRoutes,           { prefix: '/alerts' });

  // Outbound. The inverse of /x402 — the rail the credit bureau uses to pay
  // furnishers the revenue share it computes. Submission is refused rather than
  // simulated when no signer is configured; see lib/payouts.ts.
  await app.register(buildPayoutRoutes,          { prefix: '/payouts' });

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
      await getDb().query('SELECT 1', []);
      return { status: 'ready' };
    } catch (err) {
      return { status: 'not ready', error: String(err) };
    }
  });

  return app;
}

async function main() {
  // Fail fast, before we even bind a port, if shielded payments are enabled
  // in production without a real (deployed) proof-verification path. See
  // lib/proof-verifier.ts for details — this must never silently fall back
  // to the always-true stub in production.
  assertShieldedPaymentsSafeToBoot();

  const app = await buildApp();
  const db = getDb();

  // Run migrations before accepting traffic.
  //
  // src/db/migrate.ts has always existed and was never called, so on a fresh
  // database none of this service's tables were created: deposits, the
  // shielded tables, and — since the outbound rail landed — `payouts`. The
  // payout ledger is durable by design and was unreachable in practice,
  // failing at the first request with "relation payouts does not exist".
  //
  // Same shape as unified-router: fatal in production, a warning in dev so an
  // offline run without Postgres still boots.
  try {
    const { runMigrations } = await import('./db/migrate.js');
    await runMigrations(db);
  } catch (err) {
    if (config.env === 'production') throw err;
    console.warn('[stablecoin-gateway] Migrations failed — continuing (dev only):', err);
  }

  // Install the outbound signer, if the operator has asked for one.
  //
  // Deliberately after migrations and before the port opens: the signer's
  // daily spend cap reads the payouts table, and a deployment that intends to
  // move money should fail to start rather than serve traffic with a
  // broadcaster that refuses every settlement run. Saying nothing about
  // signing leaves the refusing broadcaster in place — the default posture is
  // "cannot send", never "sends".
  const { installPayoutSigner } = await import('./lib/payout-signer.js');
  const signer = installPayoutSigner();
  if (signer.installed) {
    console.warn(
      `[stablecoin-gateway] Outbound payout signer ACTIVE — ${signer.address} on ${signer.chain}`,
    );
  } else {
    console.log(`[stablecoin-gateway] Outbound payouts not signed: ${signer.reason}`);
  }

  // Which chains to watch.
  //
  // Configurable, defaulting to the original fixed set of four so nothing that
  // already relies on all-chains-on-by-default changes behavior. A deployment with
  // no real, working RPC provider for a given chain (e.g. this service's own
  // default public endpoints, meant as placeholders — see config.ts) should not
  // watch that chain until it has one.
  const ALL_MONITORED_CHAINS = ['ethereum', 'polygon', 'base', 'arbitrum'] as const;
  type MonitoredChain = (typeof ALL_MONITORED_CHAINS)[number];
  const isMonitoredChain = (c: string): c is MonitoredChain =>
    (ALL_MONITORED_CHAINS as readonly string[]).includes(c);

  const configuredChains = process.env['DEPOSIT_MONITOR_CHAINS'];
  const chains = configuredChains !== undefined
    ? configuredChains.split(',').map((c) => c.trim()).filter(isMonitoredChain)
    : ALL_MONITORED_CHAINS;

  // Check every configured token against the chain before anything is quoted or
  // paid in it: code at the address, the expected symbol, decimals read from the
  // contract. An asset that fails is unavailable, not guessed. Re-checked on a
  // timer so one that came up late (an RPC that was down at boot) becomes usable
  // without a restart.
  const ks = assertKeystoreConfigured();
  console.log(`[stablecoin-gateway] Deposit keys are wrapped by: ${ks.provider}`);
  const ctx = await gatewayContext();
  const verifyAssets = async () => {
    try {
      const statuses = await ctx.registry.verify();
      for (const st of statuses) {
        const line = `[stablecoin-gateway] ${st.symbol} on ${st.chain}: ${st.status}` +
          (st.decimals !== null ? ` (${st.decimals} decimals)` : '') + (st.problem ? ` — ${st.problem}` : '');
        (st.status === 'available' ? console.log : console.warn)(line);
      }
      return statuses.every((st) => st.status === 'available');
    } catch (err) {
      console.error('[stablecoin-gateway] Asset verification failed:', err);
      return false;
    }
  };
  let allVerified = await verifyAssets();
  setInterval(() => { void verifyAssets().then((ok) => { allVerified = ok; }); },
    Number(process.env['ASSET_VERIFY_INTERVAL_MS'] ?? (allVerified ? 600_000 : 60_000))).unref();

  // Leader election: with more than one replica, only one runs the background workers at a time
  // (see lib/leader.ts). LEADER_LOCK_ENABLED=false turns it off for a single instance.
  let leader: LeaderLock | null = null;
  let shouldRun: (() => boolean) | undefined;
  if (leaderEnabled()) {
    leader = createPgLeaderLock({
      host: config.postgres.host, port: config.postgres.port, user: config.postgres.user,
      password: config.postgres.password, database: config.postgres.database,
    }, { retryMs: Number(process.env['LEADER_RETRY_MS'] ?? '5000') });
    leader.start();
    shouldRun = () => leader!.isLeader();
  } else {
    console.warn('[stablecoin-gateway] LEADER_LOCK_ENABLED=false: do not run more than one replica, or both will run the sweeper, treasury and payout workers');
  }

  // Alerting: turn treasury shortfalls, failed/stuck payouts, failed sweeps and a stale rand rate into
  // pages. Only the leader runs it, so a second replica doesn't double-page.
  startWatchdog(db, alerts(), Number(process.env['WATCHDOG_INTERVAL_MS'] ?? '60000'), { assetsVerified: () => allVerified, shouldRun });
  if (!process.env['ALERT_WEBHOOK_URL'] && !process.env['ALERT_PAGERDUTY_ROUTING_KEY']) {
    console.warn('[stablecoin-gateway] No ALERT_WEBHOOK_URL or ALERT_PAGERDUTY_ROUTING_KEY: treasury shortfalls and failed payouts/sweeps will only appear in this log');
  }

  // Live USD/ZAR rate. Off unless asked for; the operator-set rate keeps working either way. Needs at
  // least two agreeing sources (lib/fx-feed.ts), and fails closed: a refused or missing rate just ages.
  if (process.env['FX_FEED_ENABLED'] === 'true') {
    const runner = createFeedRunner(ctx.rates, feedSourcesFromEnv(), feedConfig(),
      (o) => { void alerts().raise('fx:feed', 'warning', 'USD/ZAR feed did not update the rate', o.reason ?? 'unknown'); },
      () => { void alerts().resolve('fx:feed'); });
    startFeed(runner, Number(process.env['FX_FEED_INTERVAL_MS'] ?? 15 * 60_000), shouldRun);
    console.log('[stablecoin-gateway] Live USD/ZAR feed ON');
  } else {
    console.log('[stablecoin-gateway] Live USD/ZAR feed off (FX_FEED_ENABLED is not "true"): the rand rate is set by an operator');
  }

  // Outbound: send approved payouts automatically and finish any left in flight. Needs a
  // live signer; with none, nothing is sent and nothing is pretended. PAYOUT_AUTO_SUBMIT=false
  // leaves submission to an operator.
  if (signer.installed && process.env['PAYOUT_AUTO_SUBMIT'] !== 'false') {
    startPayoutWorker(Number(process.env['PAYOUT_WORKER_INTERVAL_MS'] ?? '15000'), {
      staleAfterMs: Number(process.env['PAYOUT_STALE_AFTER_MS'] ?? 120_000),
      shouldRun,
    });
    console.log('[stablecoin-gateway] Payout worker running: approved payouts are sent automatically');
  } else if (signer.installed) {
    console.log('[stablecoin-gateway] PAYOUT_AUTO_SUBMIT=false: approved payouts wait for POST /payouts/:id/submit');
  }

  // Sweeping: deposit addresses -> treasury. Off unless asked for, and a misconfiguration
  // when it IS asked for stops the gateway starting rather than running half-configured.
  if (sweepRequested()) {
    const sweeper = await createSweeper(resolveSweepConfig());
    startSweeper(sweeper, [...chains], Number(process.env['SWEEP_INTERVAL_MS'] ?? '60000'), shouldRun);
    console.warn('[stablecoin-gateway] Deposit sweeping ACTIVE: confirmed deposits are moved to the treasury');
  } else {
    console.log('[stablecoin-gateway] Deposit sweeping off (SWEEP_ENABLED is not "true"): paid-in funds stay in the one-time deposit addresses');
  }

  // Treasury: keep the payout wallet funded from the operating wallet, within caps, and send surplus to
  // cold storage. Needs the live signer (that wallet is what it tops up). Off unless asked for; a
  // misconfiguration when it IS asked for stops the gateway starting.
  if (treasuryRequested()) {
    const payoutAddress = (signer as { address?: string }).address;
    const tcfg = resolveTreasuryConfig(process.env, signer.installed ? payoutAddress : undefined);
    const manager = await createTreasuryManager(tcfg, payoutAddress!);
    const { setTreasuryManager } = await import('./routes/treasury.js');
    setTreasuryManager(manager);
    startTreasury(manager, Number(process.env['TREASURY_INTERVAL_MS'] ?? '60000'), shouldRun);
    console.warn(`[stablecoin-gateway] Treasury manager ACTIVE: operating wallet ${manager.warm.address} tops up payout wallet ${payoutAddress}`);
  } else {
    console.log('[stablecoin-gateway] Treasury manager off (TREASURY_MANAGER_ENABLED is not "true"): the payout wallet is topped up by hand');
  }

  // Settlement: read each chain's transfers to open deposits and confirm them once
  // final. Replaces the event-subscription monitor (lib/settlement.ts explains why).
  startSettlement(
    [...chains], (chain) => ctx.chainApi(chain), db, ctx.registry,
    {
      confirmations: (chain) => (config.confirmations as Record<string, number>)[chain] ?? 12,
      expiryGraceMs: Number(process.env['SETTLEMENT_EXPIRY_GRACE_MS'] ?? 5 * 60_000),
      lateEveryPasses: Number(process.env['SETTLEMENT_LATE_SCAN_EVERY'] ?? 30),
    },
    Number(process.env['SETTLEMENT_INTERVAL_MS'] ?? '10000'),
  );

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
    await leader?.stop(); // release leadership at once so another replica takes over without waiting
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  // ── Global error handlers (prevent silent pod crashes) ────────────────
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[stablecoin-gateway] Unhandled Rejection:', reason, promise);
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    console.error('[stablecoin-gateway] Uncaught Exception:', error);
    process.exit(1);
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[stablecoin-gateway] Listening on :${config.port}`);
}

// Only boot when this module is the process entrypoint.
//
// buildApp() was split out of main() so tests could assemble the real app
// without binding a port or starting chain monitors — but an unconditional
// main() at module scope defeated that entirely: merely importing buildApp
// listened on :8020 and spun up seven chain pollers as a side effect. Guarding
// on argv[1] is what makes the split above actually mean anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}

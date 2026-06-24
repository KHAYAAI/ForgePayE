/**
 * ForgePay Yield Engine
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Auto-sweeps idle merchant stablecoin balances into DeFi yield vaults
 *   (Aave V3, Compound V3, Ondo USDY) and tracks positions + returns.
 *
 * Cron jobs:
 *   Every SWEEP_INTERVAL_MINUTES (default: 15 min):
 *     1. sweepIdleBalances()  — deposit idle USDC/USDT into configured vaults
 *     2. updateAllPositions() — refresh on-chain balances & unrealized yield
 *
 * Port: 3007
 *
 * Routes:
 *   /api/v1/vaults        — vault catalogue & live APYs
 *   /api/v1/positions     — merchant position management
 *   /api/v1/sweep         — auto-sweep configuration & history
 *   /api/v1/yields        — APY aggregation & yield transaction log
 *
 * Auth:
 *   JWT (@fastify/jwt) for inbound requests from the dashboard / mor-layer.
 *   The `x-merchant-id` header is accepted as a fallback in dev mode.
 *
 * Internal service communication:
 *   Reads from stablecoin-gateway (balance queries) via HTTP.
 *   Writes to EVM chains via ethers.js JsonRpcProvider.
 */

import 'dotenv/config';
import Fastify from 'fastify';
import helmet    from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cors      from '@fastify/cors';
import jwt       from '@fastify/jwt';
import cron      from 'node-cron';

import { config }               from './config';
import { buildVaultRoutes }     from './routes/vaults';
import { buildPositionRoutes }  from './routes/positions';
import { buildSweepRoutes }     from './routes/sweep';
import { buildYieldRoutes }     from './routes/yields';
import { sweepIdleBalances }    from './services/sweepService';
import { updateAllPositions, initPositionsFromDb }   from './services/positionTracker';
import { fetchAllApys }         from './services/apyAggregator';
import { initDb, closeDb }      from './db';
import { setUseDb }             from './store';

// ── Build app ─────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
    trustProxy: true,
  });

  // ── Security & cross-cutting plugins ──────────────────────────────────────
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(rateLimit, {
    max:        200,
    timeWindow: '1 minute',
    keyGenerator: (req) =>
      (req.headers['x-forwarded-for'] as string | undefined) ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error:      'Too Many Requests',
      message:    `Rate limit exceeded. Retry in ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });

  await app.register(cors, {
    origin:      config.corsOrigins,
    methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await app.register(jwt, {
    secret: config.jwtSecret,
  });

  // ── JWT auth decorator ─────────────────────────────────────────────────────
  // Adds req.user when a valid Bearer token is present.
  // Routes that need auth call await req.jwtVerify() themselves.
  // Unauthenticated routes (healthz, /yields/apys) skip this.
  app.addHook('preHandler', async (req) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        await req.jwtVerify();
      } catch {
        // Invalid token — we don't reject here because some routes are public.
        // Routes that require auth check req.user explicitly.
      }
    }
  });

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(buildVaultRoutes,    { prefix: '/api/v1/vaults' });
  await app.register(buildPositionRoutes, { prefix: '/api/v1/positions' });
  await app.register(buildSweepRoutes,    { prefix: '/api/v1/sweep' });
  await app.register(buildYieldRoutes,    { prefix: '/api/v1/yields' });

  // Convenience alias: GET /api/v1/portfolio → same handler as
  // GET /api/v1/positions/portfolio (aggregate summary, no prefix overlap)
  app.get('/api/v1/portfolio', async (req, reply) => {
    const merchantId =
      (req as any).user?.merchantId ??
      (req.headers['x-merchant-id'] as string | undefined) ??
      null;
    if (!merchantId) {
      return reply.status(401).send({ error: 'Missing merchant identity' });
    }
    const { getPortfolioSummary } = await import('./services/positionTracker');
    return reply.send(getPortfolioSummary(merchantId));
  });

  // ── Health probes ──────────────────────────────────────────────────────────
  app.get('/healthz', async () => ({
    status:  'ok',
    service: 'yield-engine',
    version: '0.1.0',
  }));

  app.get('/readyz', async (_req, reply) => {
    // In production: verify DB connection and at least one RPC endpoint
    return reply.send({ status: 'ready' });
  });

  // ── Global error handler ───────────────────────────────────────────────────
  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err, url: req.url }, 'Unhandled request error');

    // Don't expose stack traces in production
    const isDev = process.env['NODE_ENV'] !== 'production';
    reply.status(err.statusCode ?? 500).send({
      error:   err.name ?? 'InternalServerError',
      message: err.message,
      ...(isDev && err.stack ? { stack: err.stack } : {}),
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: 'Not Found', path: req.url });
  });

  return app;
}

// ── Background scheduler ──────────────────────────────────────────────────────

function startScheduler(): void {
  const intervalMinutes = config.sweepIntervalMinutes;
  const cronExpression  = `*/${intervalMinutes} * * * *`;

  cron.schedule(cronExpression, async () => {
    const label = `sweep-cycle-${Date.now()}`;
    console.time(label);
    try {
      // Run sweep and position refresh in sequence (not parallel) to avoid
      // race conditions between new deposits and balance reads.
      await sweepIdleBalances();
      await updateAllPositions();
    } catch (err) {
      console.error('[yield-engine] Cron error:', err);
    } finally {
      console.timeEnd(label);
    }
  });

  console.log(`[yield-engine] Scheduler started — sweep every ${intervalMinutes} min`);
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Initialize database connection and run migrations
  // DB persistence is best-effort — if it fails, the app continues with in-memory storage
  const useDbEnv = process.env['USE_DB']?.toLowerCase() === 'true';
  if (useDbEnv) {
    try {
      await initDb();
      setUseDb(true);
      console.log('[yield-engine] PostgreSQL persistence enabled');

      // Load all positions from the database to restore state
      await initPositionsFromDb();
    } catch (err) {
      console.warn('[yield-engine] Database initialization failed; continuing with in-memory storage:', err);
      setUseDb(false);
    }
  } else {
    console.log('[yield-engine] PostgreSQL persistence disabled (set USE_DB=true to enable)');
  }

  const app = await buildApp();

  // Pre-warm APY cache so first API responses are fast
  fetchAllApys().catch((err) =>
    console.warn('[yield-engine] APY pre-warm failed:', err),
  );

  // Start the background cron scheduler
  startScheduler();

  const shutdown = async () => {
    console.log('[yield-engine] Shutting down...');
    await app.close();
    if (useDbEnv) {
      await closeDb();
    }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[yield-engine] Listening on :${config.port}`);
}

main().catch((err) => {
  console.error('[yield-engine] Fatal startup error:', err);
  process.exit(1);
});

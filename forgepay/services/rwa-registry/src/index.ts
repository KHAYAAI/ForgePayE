/**
 * ForgePay RWA (Real-World Assets) Registry
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Unified registry for tokenized real-world assets — T-bills, money
 *       market funds, bonds, and other structured products. Manages positions,
 *       income distribution, tax tracking, and redemption flows.
 *
 * Supported assets (seeded):
 *   USDY  — Ondo Finance (T-bill, 5.20% APY)
 *   FOBXX — Franklin Templeton (money market, 5.05% APY)
 *   TBILL — OpenEden (T-bill, 5.30% APY)
 *   BUIDL — BlackRock (money market, 5.00% APY, institutional)
 *   OUSG  — Ondo Finance (T-bill, 5.15% APY, accredited)
 *   USTB  — Superstate (T-bill, 5.18% APY)
 *
 * Port: 3008
 *
 * Background jobs:
 *   Every 6 hours   — NAV refresh (stub: logs intent, updates timestamps)
 *   Every 24 hours  — Income accrual + distribution to all active positions
 *
 * Routes:
 *   GET  /health
 *   GET  /v1/assets               — list/filter RWA assets
 *   GET  /v1/assets/compare       — compare all assets by APY
 *   GET  /v1/assets/:id           — get single asset
 *   POST /v1/positions            — open position
 *   GET  /v1/positions            — list positions (merchantId required)
 *   GET  /v1/positions/:id        — get position details
 *   PUT  /v1/positions/:id/update-value — refresh NAV-based value
 *   POST /v1/income/distribute    — trigger income distribution
 *   GET  /v1/income               — income history (merchantId required)
 *   GET  /v1/income/tax-summary   — tax liability summary
 *   POST /v1/redemptions          — create redemption request
 *   GET  /v1/redemptions          — list redemptions (merchantId required)
 *   GET  /v1/redemptions/:id      — get redemption details
 *   POST /v1/redemptions/:id/process  — settle redemption (stub)
 *   POST /v1/redemptions/:id/cancel   — cancel pending redemption
 *   POST /v1/nav/refresh          — manually trigger NAV refresh
 */

import Fastify, { type FastifyError } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { v4 as uuidv4 } from 'uuid';
import apiKeyAuth from './plugins/api-key-auth';

import {
  rwaAssets,
  positions,
  redemptionRequests,
  getPositionsForMerchant,
  addPosition,
} from './store';
import {
  distributeIncome,
  getIncomeHistory,
  calculateTaxLiability,
  accrueAllPendingIncome,
  distributeAllPendingIncome,
} from './income';
import {
  createRedemptionRequest,
  processRedemption,
  cancelRedemption,
} from './redemption';
import { refreshAllNAVs, getYieldComparison } from './nav';
import { runMigrations, getAllCachedNAVs, pool } from './db';
import type { MerchantRWAPosition, RedemptionSpeed } from './types';

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env['PORT'] ?? '3008', 10);
const RATE_LIMIT_PER_MIN = parseInt(process.env['RATE_LIMIT_PER_MIN'] ?? '100', 10);
const NAV_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;    // 6 hours
const INCOME_DIST_INTERVAL_MS  = 24 * 60 * 60 * 1000;  // 24 hours

// ── App builder ───────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    trustProxy: true,
  });

  // ── Plugins ────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] ?? '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false,
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(rateLimit, {
    max: RATE_LIMIT_PER_MIN,
    timeWindow: '1 minute',
    keyGenerator: (req) =>
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry in ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });

  await app.register(apiKeyAuth);

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    service: 'rwa-registry',
    version: '0.1.0',
    port: PORT,
    assetCount: rwaAssets.size,
    positionCount: positions.size,
    timestamp: new Date().toISOString(),
  }));

  // ── Metrics ────────────────────────────────────────────────────────────────
  app.get('/metrics', async (_req, reply) => {
    const { register } = await import('./lib/metrics.js');
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(await register.metrics());
  });

  // ── Asset routes ──────────────────────────────────────────────────────────

  /**
   * GET /v1/assets
   * List all RWA assets with optional filters:
   *   ?assetClass=treasury_bill
   *   ?redemptionSpeed=next_day
   *   ?minApy=500           (basis points)
   *   ?requiresAccredited=false
   *   ?chain=ethereum
   */
  app.get<{
    Querystring: {
      assetClass?: string;
      redemptionSpeed?: string;
      minApy?: string;
      requiresAccredited?: string;
      chain?: string;
    };
  }>('/v1/assets', async (req, reply) => {
    const { assetClass, redemptionSpeed, minApy, requiresAccredited, chain } = req.query;

    let assets = Array.from(rwaAssets.values());

    if (assetClass) assets = assets.filter(a => a.assetClass === assetClass);
    if (redemptionSpeed) assets = assets.filter(a => a.redemptionSpeed === redemptionSpeed);
    if (minApy !== undefined) assets = assets.filter(a => a.currentApyBps >= parseInt(minApy, 10));
    if (requiresAccredited !== undefined) {
      const flag = requiresAccredited === 'true';
      assets = assets.filter(a => a.requiresAccreditedInvestor === flag);
    }
    if (chain) assets = assets.filter(a => a.chain === chain);

    return reply.send({ data: assets, total: assets.length });
  });

  /**
   * GET /v1/assets/compare
   * Compare all active assets sorted by APY descending.
   * NOTE: This route MUST be registered before /v1/assets/:id to avoid
   * 'compare' being interpreted as an :id param.
   */
  app.get('/v1/assets/compare', async (_req, reply) => {
    return reply.send({ data: getYieldComparison() });
  });

  /**
   * GET /v1/assets/:id
   * Fetch a single RWA asset by ID.
   */
  app.get<{ Params: { id: string } }>('/v1/assets/:id', async (req, reply) => {
    const asset = rwaAssets.get(req.params.id);
    if (!asset) {
      return reply.status(404).send({ error: 'NotFound', message: `Asset ${req.params.id} not found` });
    }
    return reply.send({ data: asset });
  });

  // ── Position routes ────────────────────────────────────────────────────────

  /**
   * POST /v1/positions
   * Open a new RWA position for a merchant.
   * Body: { merchantId, assetId, units, costBasisUsd }
   */
  app.post<{
    Body: { merchantId: string; assetId: string; units: number; costBasisUsd: number };
  }>('/v1/positions', async (req, reply) => {
    const { merchantId, assetId, units, costBasisUsd } = req.body ?? {};

    if (!merchantId || !assetId || units === undefined || costBasisUsd === undefined) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'merchantId, assetId, units, and costBasisUsd are required',
      });
    }
    if (units <= 0) {
      return reply.status(400).send({ error: 'ValidationError', message: 'units must be positive' });
    }

    const asset = rwaAssets.get(assetId);
    if (!asset) {
      return reply.status(404).send({ error: 'NotFound', message: `Asset ${assetId} not found` });
    }
    if (asset.status !== 'active') {
      return reply.status(409).send({ error: 'AssetNotActive', message: `Asset ${asset.symbol} is not currently accepting investments` });
    }

    const currentValueUsd = units * asset.nav;
    if (currentValueUsd < asset.minimumInvestmentUsd) {
      return reply.status(400).send({
        error: 'BelowMinimum',
        message: `Minimum investment is $${asset.minimumInvestmentUsd}; position value is $${currentValueUsd.toFixed(2)}`,
      });
    }

    const now = new Date().toISOString();
    const position: MerchantRWAPosition = {
      id: uuidv4(),
      merchantId,
      assetId,
      units,
      costBasisUsd,
      currentValueUsd,
      unrealizedGainUsd: currentValueUsd - costBasisUsd,
      totalIncomeEarnedUsd: 0,
      pendingIncomeUsd: 0,
      pendingRedemptionUnits: 0,
      pendingRedemptionUsd: 0,
      openedAt: now,
      lastUpdatedAt: now,
    };

    addPosition(position);
    return reply.status(201).send({ data: position });
  });

  /**
   * GET /v1/positions
   * List all positions for a merchant (query: merchantId required).
   */
  app.get<{ Querystring: { merchantId?: string } }>('/v1/positions', async (req, reply) => {
    const { merchantId } = req.query;
    if (!merchantId) {
      return reply.status(400).send({ error: 'ValidationError', message: 'merchantId query param is required' });
    }
    const merchantPositions = getPositionsForMerchant(merchantId);
    return reply.send({ data: merchantPositions, total: merchantPositions.length });
  });

  /**
   * GET /v1/positions/:id
   * Get a single position by ID.
   */
  app.get<{ Params: { id: string } }>('/v1/positions/:id', async (req, reply) => {
    const position = positions.get(req.params.id);
    if (!position) {
      return reply.status(404).send({ error: 'NotFound', message: `Position ${req.params.id} not found` });
    }
    return reply.send({ data: position });
  });

  /**
   * PUT /v1/positions/:id/update-value
   * Recalculates currentValueUsd and unrealizedGainUsd using the latest NAV.
   */
  app.put<{ Params: { id: string } }>('/v1/positions/:id/update-value', async (req, reply) => {
    const position = positions.get(req.params.id);
    if (!position) {
      return reply.status(404).send({ error: 'NotFound', message: `Position ${req.params.id} not found` });
    }
    const asset = rwaAssets.get(position.assetId);
    if (!asset) {
      return reply.status(404).send({ error: 'NotFound', message: `Asset ${position.assetId} not found` });
    }

    position.currentValueUsd = position.units * asset.nav;
    position.unrealizedGainUsd = position.currentValueUsd - position.costBasisUsd;
    position.lastUpdatedAt = new Date().toISOString();

    return reply.send({ data: position });
  });

  // ── Income routes ──────────────────────────────────────────────────────────

  /**
   * POST /v1/income/distribute
   * Trigger income distribution for a specific merchant + asset.
   * Body: { merchantId, assetId }
   */
  app.post<{
    Body: { merchantId: string; assetId: string; positionId?: string };
  }>('/v1/income/distribute', async (req, reply) => {
    const { merchantId, assetId, positionId } = req.body ?? {};
    if (!merchantId || !assetId) {
      return reply.status(400).send({ error: 'ValidationError', message: 'merchantId and assetId are required' });
    }

    // Find the position(s) to distribute for
    let targetPositions = getPositionsForMerchant(merchantId).filter(p => p.assetId === assetId);
    if (positionId) targetPositions = targetPositions.filter(p => p.id === positionId);

    if (targetPositions.length === 0) {
      return reply.status(404).send({
        error: 'NotFound',
        message: `No positions found for merchant ${merchantId} and asset ${assetId}`,
      });
    }

    const distributions = [];
    for (const pos of targetPositions) {
      try {
        const dist = distributeIncome(merchantId, assetId, pos.id);
        distributions.push(dist);
      } catch (err) {
        app.log.warn({ err, positionId: pos.id }, 'Income distribution failed for position');
      }
    }

    return reply.send({ data: distributions, distributed: distributions.length });
  });

  /**
   * GET /v1/income
   * Get income history for a merchant (merchantId required, assetId optional).
   */
  app.get<{
    Querystring: { merchantId?: string; assetId?: string };
  }>('/v1/income', async (req, reply) => {
    const { merchantId, assetId } = req.query;
    if (!merchantId) {
      return reply.status(400).send({ error: 'ValidationError', message: 'merchantId query param is required' });
    }
    const history = getIncomeHistory(merchantId, assetId);
    return reply.send({ data: history, total: history.length });
  });

  /**
   * GET /v1/income/tax-summary
   * Get tax liability summary grouped by TaxTreatment.
   * Query: merchantId required, year optional (filters by calendar year).
   */
  app.get<{
    Querystring: { merchantId?: string; year?: string };
  }>('/v1/income/tax-summary', async (req, reply) => {
    const { merchantId, year } = req.query;
    if (!merchantId) {
      return reply.status(400).send({ error: 'ValidationError', message: 'merchantId query param is required' });
    }

    let distributions = getIncomeHistory(merchantId);

    if (year) {
      distributions = distributions.filter(d => d.distributionDate.startsWith(year));
    }

    const taxLiability = calculateTaxLiability(distributions);
    const totalTaxable = Object.values(taxLiability).reduce((sum, v) => sum + v, 0);

    return reply.send({
      merchantId,
      year: year ?? 'all',
      taxLiability,
      totalTaxableIncome: totalTaxable,
      distributionCount: distributions.length,
    });
  });

  // ── Redemption routes ──────────────────────────────────────────────────────

  /**
   * POST /v1/redemptions
   * Create a redemption request.
   * Body: { merchantId, assetId, positionId, units, speed? }
   */
  app.post<{
    Body: {
      merchantId: string;
      assetId: string;
      positionId: string;
      units: number;
      speed?: RedemptionSpeed;
    };
  }>('/v1/redemptions', async (req, reply) => {
    const { merchantId, assetId, positionId, units, speed } = req.body ?? {};

    if (!merchantId || !assetId || !positionId || units === undefined) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'merchantId, assetId, positionId, and units are required',
      });
    }
    if (units <= 0) {
      return reply.status(400).send({ error: 'ValidationError', message: 'units must be positive' });
    }

    try {
      const request = createRedemptionRequest(merchantId, assetId, positionId, units, speed);
      return reply.status(201).send({ data: request });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: 'RedemptionError', message });
    }
  });

  /**
   * GET /v1/redemptions
   * List redemption requests (merchantId required, status optional).
   */
  app.get<{
    Querystring: { merchantId?: string; status?: string };
  }>('/v1/redemptions', async (req, reply) => {
    const { merchantId, status } = req.query;
    if (!merchantId) {
      return reply.status(400).send({ error: 'ValidationError', message: 'merchantId query param is required' });
    }

    let requests = Array.from(redemptionRequests.values()).filter(r => r.merchantId === merchantId);
    if (status) requests = requests.filter(r => r.status === status);

    return reply.send({ data: requests, total: requests.length });
  });

  /**
   * GET /v1/redemptions/:id
   * Get a single redemption request by ID.
   */
  app.get<{ Params: { id: string } }>('/v1/redemptions/:id', async (req, reply) => {
    const request = redemptionRequests.get(req.params.id);
    if (!request) {
      return reply.status(404).send({ error: 'NotFound', message: `Redemption request ${req.params.id} not found` });
    }
    return reply.send({ data: request });
  });

  /**
   * POST /v1/redemptions/:id/process
   * Process (settle) a pending redemption request.
   */
  app.post<{ Params: { id: string } }>('/v1/redemptions/:id/process', async (req, reply) => {
    try {
      const request = processRedemption(req.params.id);
      return reply.send({ data: request });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: 'ProcessError', message });
    }
  });

  /**
   * POST /v1/redemptions/:id/cancel
   * Cancel a pending redemption request and restore the unit hold.
   */
  app.post<{ Params: { id: string } }>('/v1/redemptions/:id/cancel', async (req, reply) => {
    try {
      cancelRedemption(req.params.id);
      return reply.send({ success: true, message: `Redemption ${req.params.id} cancelled` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: 'CancelError', message });
    }
  });

  // ── NAV routes ─────────────────────────────────────────────────────────────

  /**
   * POST /v1/nav/refresh
   * Manually trigger a NAV refresh for all assets.
   */
  app.post('/v1/nav/refresh', async (_req, reply) => {
    await refreshAllNAVs();
    return reply.send({
      success: true,
      message: 'NAV refresh triggered for all assets',
      assetCount: rwaAssets.size,
      refreshedAt: new Date().toISOString(),
    });
  });

  // ── Error handlers ─────────────────────────────────────────────────────────
  app.setErrorHandler<FastifyError>((err, req, reply) => {
    req.log.error({ err, url: req.url }, 'Unhandled request error');
    const isDev = process.env['NODE_ENV'] !== 'production';
    reply.status(err.statusCode ?? 500).send({
      error: err.name ?? 'InternalServerError',
      message: err.message,
      ...(isDev && err.stack ? { stack: err.stack } : {}),
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: 'NotFound', path: req.url });
  });

  return app;
}

export { buildApp };

// ── Background jobs ───────────────────────────────────────────────────────────

function startBackgroundJobs(app: Awaited<ReturnType<typeof buildApp>>): void {
  // NAV refresh — every 6 hours
  const navInterval = setInterval(async () => {
    try {
      await refreshAllNAVs();
    } catch (err) {
      app.log.error({ err }, '[rwa-registry] NAV refresh cycle error');
    }
  }, NAV_REFRESH_INTERVAL_MS);

  // Income accrual + distribution — every 24 hours
  const incomeInterval = setInterval(() => {
    try {
      accrueAllPendingIncome();
      distributeAllPendingIncome();
    } catch (err) {
      app.log.error({ err }, '[rwa-registry] Income distribution cycle error');
    }
  }, INCOME_DIST_INTERVAL_MS);

  // Clean up on shutdown
  process.once('SIGTERM', () => { clearInterval(navInterval); clearInterval(incomeInterval); });
  process.once('SIGINT',  () => { clearInterval(navInterval); clearInterval(incomeInterval); });

  app.log.info('[rwa-registry] Background jobs started — NAV refresh every 6h, income distribution every 24h');
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function initNavCacheFromDb(): Promise<void> {
  try {
    await runMigrations();
    console.log('[rwa-registry] Database migrations complete');

    const cachedNAVs = await getAllCachedNAVs();
    let loadedCount = 0;

    for (const asset of rwaAssets.values()) {
      if (cachedNAVs[asset.symbol] !== undefined) {
        asset.nav = cachedNAVs[asset.symbol];
        loadedCount++;
      }
    }

    console.log(`[rwa-registry] Loaded ${loadedCount} cached NAVs from database`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn('[rwa-registry] Failed to initialize NAV cache from DB:', errorMsg);
    // Continue startup even if DB init fails — assets will use seed NAVs
  }
}

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async () => {
    app.log.info('[rwa-registry] Shutting down...');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Initialize NAV cache from database on startup
  await initNavCacheFromDb();

  startBackgroundJobs(app);

  // Initial NAV refresh on startup
  await refreshAllNAVs();

  await app.listen({ port: PORT, host: '0.0.0.0' });

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           ForgePay RWA Registry — Port ${PORT}                     ║
║                                                                  ║
║  Assets           →  GET  /v1/assets                            ║
║  Yield Compare    →  GET  /v1/assets/compare                    ║
║  Open Position    →  POST /v1/positions                         ║
║  Distribute Income→  POST /v1/income/distribute                 ║
║  Tax Summary      →  GET  /v1/income/tax-summary                ║
║  Redeem           →  POST /v1/redemptions                       ║
║  NAV Refresh      →  POST /v1/nav/refresh                       ║
╚══════════════════════════════════════════════════════════════════╝
`);
}

main().catch((err) => {
  console.error('[rwa-registry] Fatal startup error:', err);
  process.exit(1);
});

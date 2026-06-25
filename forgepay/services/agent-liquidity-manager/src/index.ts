/**
 * ForgePay Agent Liquidity Manager
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Manages multi-asset agent portfolios — auto-sweep idle balances to
 *       yield, auto-liquidate to fund obligations, multi-currency rebalancing.
 *
 * Features:
 *   1. Wallet registry              — per-agent multi-chain wallets
 *   2. Portfolio snapshot           — USD totals, asset breakdown, idle/deployed
 *   3. Liquidity policy             — min liquid floor, max idle ceiling
 *   4. Allocation targets           — stables/treasuries/eth/btc target mix
 *   5. Rebalance engine             — drift-aware buy/sell action plan
 *   6. Auto-sweep / liquidate       — yield-engine integration
 *   7. History log                  — rebalance / sweep / liquidate events
 *
 * Port: 3014
 *
 * Env vars:
 *   YIELD_ENGINE_URL    — default http://localhost:3007
 *   CORS_ORIGIN         — default *
 *   RATE_LIMIT_PER_MIN  — default 100
 *   LOG_LEVEL           — default info
 */

import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { z } from 'zod';

import {
  registerWallet,
  updateWalletAssets,
  getWalletsForAgent,
  getPolicy,
  setPolicy,
  getTarget,
  setTarget,
  appendHistory,
  getHistory,
  listAllWallets,
} from './store';
import {
  computeRebalance,
  snapshotAllocation,
  validateTargetSum,
  getAssetClass,
  toUsd,
} from './rebalancer';
import {
  sweepToYield,
  liquidateFromYield,
  computeLiquidStableUsd,
} from './sweeper';
import type {
  AgentWallet,
  AssetBalance,
  LiquidityPolicy,
  PortfolioSnapshot,
  PortfolioTarget,
  AssetClass,
} from './types';

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT               = parseInt(process.env['PORT'] ?? '3014', 10);
const RATE_LIMIT_PER_MIN = parseInt(process.env['RATE_LIMIT_PER_MIN'] ?? '100', 10);

// ── Zod schemas ───────────────────────────────────────────────────────────────

const AssetBalanceSchema = z.object({
  asset:         z.string().min(1),
  balanceNative: z.number().nonnegative(),
  balanceUsd:    z.number().nonnegative().default(0),
  chain:         z.string().min(1),
  yieldApy:      z.number().optional(),
});

const RegisterWalletSchema = z.object({
  chain:   z.string().min(1),
  address: z.string().min(1),
  assets:  z.array(AssetBalanceSchema).default([]),
});

const UpdateWalletSchema = z.object({
  assets: z.array(AssetBalanceSchema),
});

const PolicySchema = z.object({
  minLiquidStableUsd:    z.number().nonnegative(),
  maxIdleStableUsd:      z.number().nonnegative(),
  sweepVault:            z.enum(['aave', 'compound', 'ondo']),
  autoLiquidateBelowUsd: z.number().nonnegative(),
  allowedAssets:         z.array(z.string().min(1)).default([]),
});

const TargetSchema = z.object({
  stables:    z.number().min(0).max(1),
  treasuries: z.number().min(0).max(1),
  eth:        z.number().min(0).max(1),
  btc:        z.number().min(0).max(1),
  other:      z.number().min(0).max(1).optional(),
});

// ── Snapshot helper ───────────────────────────────────────────────────────────

function buildSnapshot(agentId: string, wallets: AgentWallet[]): PortfolioSnapshot {
  const snap = snapshotAllocation(wallets);
  const byAsset: Record<string, { balanceUsd: number; balanceNative: number; chain: string }> = {};
  let idleStable = 0;
  let deployed   = 0;

  for (const w of wallets) {
    for (const a of w.assets) {
      const usd = a.balanceUsd > 0 ? a.balanceUsd : toUsd(a.balanceNative, a.asset);
      const key = a.asset.toUpperCase();
      if (!byAsset[key]) {
        byAsset[key] = { balanceUsd: 0, balanceNative: 0, chain: a.chain };
      }
      byAsset[key].balanceUsd     += usd;
      byAsset[key].balanceNative  += a.balanceNative;

      const cls = getAssetClass(a.asset);
      if (cls === 'stables') {
        if ((a.yieldApy ?? 0) > 0) deployed += usd;
        else                       idleStable += usd;
      } else if (cls === 'treasuries') {
        deployed += usd;
      }
    }
  }

  return {
    agentId,
    totalUsd:         snap.totalUsd,
    byAsset,
    byClass:          snap.byClass,
    idleStableUsd:    idleStable,
    deployedYieldUsd: deployed,
    walletCount:      wallets.length,
    snapshotAt:       new Date().toISOString(),
  };
}

// ── App builder ───────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({
    logger:     { level: process.env['LOG_LEVEL'] ?? 'info' },
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin:      process.env['CORS_ORIGIN'] ?? '*',
    methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false,
  });

  await app.register(rateLimit, {
    max:        RATE_LIMIT_PER_MIN,
    timeWindow: '1 minute',
    keyGenerator: (req) =>
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error:      'Too Many Requests',
      message:    `Rate limit exceeded. Retry in ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status:    'ok',
    service:   'agent-liquidity-manager',
    version:   '0.1.0',
    port:      PORT,
    timestamp: new Date().toISOString(),
  }));

  // ── Metrics ────────────────────────────────────────────────────────────────
  app.get('/metrics', async (_req, reply) => {
    const { Metrics } = await import('./lib/metrics.js');
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(await Metrics.register());
  });

  // ── Portfolio ──────────────────────────────────────────────────────────────
  app.get<{ Params: { agentId: string } }>('/v1/agents/:agentId/portfolio', async (req, reply) => {
    const wallets = getWalletsForAgent(req.params.agentId);
    return reply.send({ data: buildSnapshot(req.params.agentId, wallets) });
  });

  // ── Wallets ────────────────────────────────────────────────────────────────
  app.post<{ Params: { agentId: string } }>('/v1/agents/:agentId/wallets', async (req, reply) => {
    const parse = RegisterWalletSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const w = registerWallet(req.params.agentId, parse.data.chain, parse.data.address, parse.data.assets as AssetBalance[]);
    return reply.status(201).send({ data: w });
  });

  app.put<{ Params: { agentId: string; walletId: string } }>(
    '/v1/agents/:agentId/wallets/:walletId',
    async (req, reply) => {
      const parse = UpdateWalletSchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
      }
      const w = updateWalletAssets(req.params.walletId, parse.data.assets as AssetBalance[]);
      if (!w) {
        return reply.status(404).send({ error: 'NotFound', message: `Wallet ${req.params.walletId} not found` });
      }
      if (w.agentId !== req.params.agentId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Wallet does not belong to agent' });
      }
      return reply.send({ data: w });
    },
  );

  // ── Policy ─────────────────────────────────────────────────────────────────
  app.get<{ Params: { agentId: string } }>('/v1/agents/:agentId/policy', async (req, reply) => {
    const p = getPolicy(req.params.agentId);
    if (!p) {
      return reply.status(404).send({ error: 'NotFound', message: `No policy for agent ${req.params.agentId}` });
    }
    return reply.send({ data: p });
  });

  app.put<{ Params: { agentId: string } }>('/v1/agents/:agentId/policy', async (req, reply) => {
    const parse = PolicySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    const p: LiquidityPolicy = setPolicy({ agentId: req.params.agentId, ...parse.data });
    return reply.send({ data: p });
  });

  // ── Target ─────────────────────────────────────────────────────────────────
  app.get<{ Params: { agentId: string } }>('/v1/agents/:agentId/target', async (req, reply) => {
    const t = getTarget(req.params.agentId);
    if (!t) {
      return reply.status(404).send({ error: 'NotFound', message: `No target for agent ${req.params.agentId}` });
    }
    return reply.send({ data: t });
  });

  app.put<{ Params: { agentId: string } }>('/v1/agents/:agentId/target', async (req, reply) => {
    const parse = TargetSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }
    if (!validateTargetSum(parse.data)) {
      return reply.status(400).send({
        error:   'ValidationError',
        message: 'Allocation targets must sum to 1.0 (±0.001)',
      });
    }
    const target: PortfolioTarget = setTarget({ agentId: req.params.agentId, ...parse.data });
    return reply.send({ data: target });
  });

  // ── Rebalance ──────────────────────────────────────────────────────────────
  app.post<{ Params: { agentId: string }; Querystring: { execute?: string } }>(
    '/v1/agents/:agentId/rebalance',
    async (req, reply) => {
      const target = getTarget(req.params.agentId);
      if (!target) {
        return reply.status(400).send({ error: 'NoTarget', message: 'Set an allocation target first' });
      }
      const wallets = getWalletsForAgent(req.params.agentId);
      const actions = computeRebalance(wallets, target);

      const execute = (req.query as { execute?: string }).execute === 'true';
      if (execute) {
        for (const a of actions) {
          a.executedAt = new Date().toISOString();
          app.log.info({ agentId: req.params.agentId, action: a }, '[alm] Executing rebalance leg (stub)');
        }
        appendHistory(req.params.agentId, 'rebalance', { actions, executed: true });
      } else if (actions.length > 0) {
        appendHistory(req.params.agentId, 'rebalance', { actions, executed: false });
      }

      return reply.send({
        data:      actions,
        executed:  execute,
        skipped:   actions.length === 0,
        totalLegs: actions.length,
        timestamp: new Date().toISOString(),
      });
    },
  );

  // ── Sweep ──────────────────────────────────────────────────────────────────
  app.post<{ Params: { agentId: string } }>('/v1/agents/:agentId/sweep', async (req, reply) => {
    const policy = getPolicy(req.params.agentId);
    if (!policy) {
      return reply.status(400).send({ error: 'NoPolicy', message: 'Set a liquidity policy first' });
    }
    const wallets = getWalletsForAgent(req.params.agentId);
    const result  = await sweepToYield(req.params.agentId, policy, wallets);
    if (result.status === 'swept') {
      appendHistory(req.params.agentId, 'sweep', { amountUsd: result.amountUsd, vault: result.vault });
    }
    return reply.send({ data: result });
  });

  // ── Liquidate ──────────────────────────────────────────────────────────────
  app.post<{ Params: { agentId: string } }>('/v1/agents/:agentId/liquidate', async (req, reply) => {
    const policy = getPolicy(req.params.agentId);
    if (!policy) {
      return reply.status(400).send({ error: 'NoPolicy', message: 'Set a liquidity policy first' });
    }
    const wallets = getWalletsForAgent(req.params.agentId);
    const result  = await liquidateFromYield(req.params.agentId, policy, wallets);
    if (result.status === 'liquidated') {
      appendHistory(req.params.agentId, 'liquidate', { amountUsd: result.amountUsd });
    }
    return reply.send({ data: result });
  });

  // ── History ────────────────────────────────────────────────────────────────
  app.get<{ Params: { agentId: string }; Querystring: { limit?: string } }>(
    '/v1/agents/:agentId/history',
    async (req, reply) => {
      const limit = parseInt((req.query as { limit?: string }).limit ?? '50', 10);
      const events = getHistory(req.params.agentId, Math.min(limit, 200));
      return reply.send({ data: events, total: events.length });
    },
  );

  // ── Global agent summary ───────────────────────────────────────────────────
  app.get('/v1/agent/summary', async (_req, reply) => {
    const wallets = listAllWallets();
    const agentIds = new Set(wallets.map(w => w.agentId));

    let totalAumUsd       = 0;
    let totalDeployedUsd  = 0;
    let totalIdleStable   = 0;
    const byClass: Record<AssetClass, number> = {
      stables: 0, treasuries: 0, eth: 0, btc: 0, other: 0,
    };

    for (const agentId of agentIds) {
      const agentWallets = wallets.filter(w => w.agentId === agentId);
      const snap = buildSnapshot(agentId, agentWallets);
      totalAumUsd      += snap.totalUsd;
      totalDeployedUsd += snap.deployedYieldUsd;
      totalIdleStable  += snap.idleStableUsd;
      for (const k of Object.keys(byClass) as AssetClass[]) {
        byClass[k] += snap.byClass[k] ?? 0;
      }
    }

    const totalLiquidStable = computeLiquidStableUsd(wallets);

    return reply.send({
      totalAumUsd,
      totalAgents:      agentIds.size,
      totalWallets:     wallets.length,
      totalDeployedUsd,
      totalIdleStable,
      totalLiquidStable,
      byClass,
      timestamp:        new Date().toISOString(),
    });
  });

  // ── Error handlers ─────────────────────────────────────────────────────────
  app.setErrorHandler<FastifyError>((err, req, reply) => {
    req.log.error({ err, url: req.url }, 'Unhandled request error');
    const isDev = process.env['NODE_ENV'] !== 'production';
    reply.status(err.statusCode ?? 500).send({
      error:   err.name ?? 'InternalServerError',
      message: err.message,
      ...(isDev && err.stack ? { stack: err.stack } : {}),
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: 'NotFound', path: req.url });
  });

  return app;
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async () => {
    app.log.info('[alm] Shutting down...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  await app.listen({ port: PORT, host: '0.0.0.0' });

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║       ForgePay Agent Liquidity Manager v0.1.0                ║
║       Listening on port ${PORT}                                 ║
║                                                              ║
║  Portfolio       →  GET  /v1/agents/:id/portfolio            ║
║  Register Wallet →  POST /v1/agents/:id/wallets              ║
║  Policy          →  PUT  /v1/agents/:id/policy               ║
║  Target          →  PUT  /v1/agents/:id/target               ║
║  Rebalance       →  POST /v1/agents/:id/rebalance            ║
║  Sweep           →  POST /v1/agents/:id/sweep                ║
║  Liquidate       →  POST /v1/agents/:id/liquidate            ║
║  History         →  GET  /v1/agents/:id/history              ║
║  Global Summary  →  GET  /v1/agent/summary                   ║
╚══════════════════════════════════════════════════════════════╝
`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[agent-liquidity-manager] Fatal startup error:', err);
    process.exit(1);
  });
}

export { buildApp };

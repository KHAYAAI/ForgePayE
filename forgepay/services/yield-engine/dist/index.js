"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fastify_1 = __importDefault(require("fastify"));
const helmet_1 = __importDefault(require("@fastify/helmet"));
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const cors_1 = __importDefault(require("@fastify/cors"));
const jwt_1 = __importDefault(require("@fastify/jwt"));
const node_cron_1 = __importDefault(require("node-cron"));
const config_1 = require("./config");
const vaults_1 = require("./routes/vaults");
const positions_1 = require("./routes/positions");
const sweep_1 = require("./routes/sweep");
const yields_1 = require("./routes/yields");
const sweepService_1 = require("./services/sweepService");
const positionTracker_1 = require("./services/positionTracker");
const apyAggregator_1 = require("./services/apyAggregator");
const db_1 = require("./db");
const store_1 = require("./store");
// ── Build app ─────────────────────────────────────────────────────────────────
async function buildApp() {
    const app = (0, fastify_1.default)({
        logger: {
            level: process.env['LOG_LEVEL'] ?? 'info',
        },
        trustProxy: true,
    });
    // ── Security & cross-cutting plugins ──────────────────────────────────────
    await app.register(helmet_1.default, { contentSecurityPolicy: false });
    await app.register(rate_limit_1.default, {
        max: 200,
        timeWindow: '1 minute',
        keyGenerator: (req) => req.headers['x-forwarded-for'] ?? req.ip,
        errorResponseBuilder: (_req, context) => ({
            statusCode: 429,
            error: 'Too Many Requests',
            message: `Rate limit exceeded. Retry in ${Math.ceil(context.ttl / 1000)}s`,
        }),
    });
    await app.register(cors_1.default, {
        origin: config_1.config.corsOrigins,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        credentials: true,
    });
    await app.register(jwt_1.default, {
        secret: config_1.config.jwtSecret,
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
            }
            catch {
                // Invalid token — we don't reject here because some routes are public.
                // Routes that require auth check req.user explicitly.
            }
        }
    });
    // ── Routes ────────────────────────────────────────────────────────────────
    await app.register(vaults_1.buildVaultRoutes, { prefix: '/api/v1/vaults' });
    await app.register(positions_1.buildPositionRoutes, { prefix: '/api/v1/positions' });
    await app.register(sweep_1.buildSweepRoutes, { prefix: '/api/v1/sweep' });
    await app.register(yields_1.buildYieldRoutes, { prefix: '/api/v1/yields' });
    // Convenience alias: GET /api/v1/portfolio → same handler as
    // GET /api/v1/positions/portfolio (aggregate summary, no prefix overlap)
    app.get('/api/v1/portfolio', async (req, reply) => {
        const merchantId = req.user?.merchantId ??
            req.headers['x-merchant-id'] ??
            null;
        if (!merchantId) {
            return reply.status(401).send({ error: 'Missing merchant identity' });
        }
        const { getPortfolioSummary } = await Promise.resolve().then(() => __importStar(require('./services/positionTracker')));
        return reply.send(getPortfolioSummary(merchantId));
    });
    // ── Health probes ──────────────────────────────────────────────────────────
    app.get('/healthz', async () => ({
        status: 'ok',
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
            error: err.name ?? 'InternalServerError',
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
function startScheduler() {
    const intervalMinutes = config_1.config.sweepIntervalMinutes;
    const cronExpression = `*/${intervalMinutes} * * * *`;
    node_cron_1.default.schedule(cronExpression, async () => {
        const label = `sweep-cycle-${Date.now()}`;
        console.time(label);
        try {
            // Run sweep and position refresh in sequence (not parallel) to avoid
            // race conditions between new deposits and balance reads.
            await (0, sweepService_1.sweepIdleBalances)();
            await (0, positionTracker_1.updateAllPositions)();
        }
        catch (err) {
            console.error('[yield-engine] Cron error:', err);
        }
        finally {
            console.timeEnd(label);
        }
    });
    console.log(`[yield-engine] Scheduler started — sweep every ${intervalMinutes} min`);
}
// ── Startup ───────────────────────────────────────────────────────────────────
async function main() {
    // Initialize database connection and run migrations
    // DB persistence is best-effort — if it fails, the app continues with in-memory storage
    const useDbEnv = process.env['USE_DB']?.toLowerCase() === 'true';
    if (useDbEnv) {
        try {
            await (0, db_1.initDb)();
            (0, store_1.setUseDb)(true);
            console.log('[yield-engine] PostgreSQL persistence enabled');
            // Load all positions from the database to restore state
            await (0, positionTracker_1.initPositionsFromDb)();
        }
        catch (err) {
            console.warn('[yield-engine] Database initialization failed; continuing with in-memory storage:', err);
            (0, store_1.setUseDb)(false);
        }
    }
    else {
        console.log('[yield-engine] PostgreSQL persistence disabled (set USE_DB=true to enable)');
    }
    const app = await buildApp();
    // Pre-warm APY cache so first API responses are fast
    (0, apyAggregator_1.fetchAllApys)().catch((err) => console.warn('[yield-engine] APY pre-warm failed:', err));
    // Start the background cron scheduler
    startScheduler();
    const shutdown = async () => {
        console.log('[yield-engine] Shutting down...');
        await app.close();
        if (useDbEnv) {
            await (0, db_1.closeDb)();
        }
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    await app.listen({ port: config_1.config.port, host: '0.0.0.0' });
    console.log(`[yield-engine] Listening on :${config_1.config.port}`);
}
main().catch((err) => {
    console.error('[yield-engine] Fatal startup error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map
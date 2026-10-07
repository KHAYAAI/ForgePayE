"use strict";
/**
 * ForgePay Agent Decision Framework
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Autonomous decision logic for AI agents — risk scoring, counterparty
 *       trust evaluation, and policy-based approval workflows.
 *
 * Features:
 *   1. Deterministic Risk Scoring      — reputation + amount + velocity + policy
 *   2. Global Policy CRUD              — rule-based gates evaluated per request
 *   3. Per-Agent Policy Overrides      — risk tolerance, daily limits, blocklist
 *   4. Velocity Tracking               — rolling 1h/24h/7d windows per agent
 *   5. Decision Audit Log              — last 500 decisions, queryable
 *
 * Port: 3013
 *
 * Env vars:
 *   AGENT_IDENTITY_URL     — default http://localhost:3010
 *   AGENT_IDENTITY_API_KEY — key sent to agent-identity's protected routes
 *   ADF_ADMIN_API_KEY      — operator key (all scopes); required in production
 *   ADF_SERVICE_API_KEYS   — comma-separated internal-caller keys (evaluate + read)
 *   CORS_ORIGIN            — default *
 *   RATE_LIMIT_PER_MIN     — default 100
 *   LOG_LEVEL              — default info
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
exports.resolveCorsOrigin = resolveCorsOrigin;
exports.buildApp = buildApp;
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const helmet_1 = __importDefault(require("@fastify/helmet"));
const zod_1 = require("zod");
const policies_1 = require("./policies");
const risk_scorer_1 = require("./risk-scorer");
const decision_log_1 = require("./decision-log");
const persistence_1 = require("./persistence");
const velocity_1 = require("./velocity");
const auth_1 = require("./auth");
const instrumentation_1 = require("./lib/instrumentation");
// ── Configuration ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env['PORT'] ?? '3013', 10);
const AGENT_IDENTITY_URL = process.env['AGENT_IDENTITY_URL'] ?? 'http://localhost:3010';
const RATE_LIMIT_PER_MIN = parseInt(process.env['RATE_LIMIT_PER_MIN'] ?? '100', 10);
// ── Zod schemas ───────────────────────────────────────────────────────────────
const ActionTypeSchema = zod_1.z.enum(['payment', 'transfer', 'swap', 'subscription', 'refund', 'payout', 'custom']);
const DecisionRequestSchema = zod_1.z.object({
    agentId: zod_1.z.string().min(1),
    actionType: ActionTypeSchema,
    counterpartyAgentId: zod_1.z.string().min(1).optional(),
    amountUsd: zod_1.z.number().nonnegative(),
    asset: zod_1.z.string().min(1),
    metadata: zod_1.z.record(zod_1.z.unknown()).optional(),
});
const PolicyTypeSchema = zod_1.z.enum([
    'block_low_reputation',
    'block_high_amount',
    'require_approval_above',
    'block_blocked_counterparty',
    'block_velocity_exceeded',
    'block_unknown_counterparty',
]);
const PolicyParamsSchema = zod_1.z.object({
    minReputation: zod_1.z.number().min(0).max(100).optional(),
    maxAmountUsd: zod_1.z.number().nonnegative().optional(),
    thresholdUsd: zod_1.z.number().nonnegative().optional(),
    maxDailyVolumeUsd: zod_1.z.number().nonnegative().optional(),
}).strict();
const PolicyCreateSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1),
    type: PolicyTypeSchema,
    params: PolicyParamsSchema.default({}),
    enabled: zod_1.z.boolean().default(true),
});
const PolicyUpdateSchema = PolicyCreateSchema.partial().omit({ id: true });
const AgentPolicyUpdateSchema = zod_1.z.object({
    riskTolerance: zod_1.z.number().min(0).max(100).optional(),
    dailyLimitUsd: zod_1.z.number().positive().optional(),
    blockedCounterparties: zod_1.z.array(zod_1.z.string().min(1)).optional(),
    requiredApprovalThresholdUsd: zod_1.z.number().positive().optional(),
});
/**
 * Resolve the CORS origin allowlist.
 *
 * `CORS_ORIGIN` defaults to `*` for local/demo use. That default reaching
 * production would let any website's browser JS read every response this
 * service returns. Comma-separated origins are supported so a real
 * deployment can list every trusted caller (dashboard, mobile web, ...)
 * rather than being forced back to `*` for lack of a multi-origin option.
 *
 * @throws in production when CORS_ORIGIN is unset or still `*`.
 */
function resolveCorsOrigin() {
    const raw = process.env['CORS_ORIGIN'];
    const isProduction = process.env['NODE_ENV'] === 'production';
    if (isProduction && (!raw || raw === '*')) {
        throw new Error('CORS_ORIGIN is not set (or is "*") in production. The decision framework refuses to ' +
            'start without an explicit origin allowlist — set it to a comma-separated list of ' +
            'trusted origins, e.g. CORS_ORIGIN=https://dashboard.myforgepay.com,https://app.myforgepay.com');
    }
    if (!raw)
        return '*';
    const origins = raw.split(',').map((o) => o.trim()).filter(Boolean);
    return origins.length === 1 ? origins[0] : origins;
}
// ── App builder ───────────────────────────────────────────────────────────────
async function buildApp() {
    const app = (0, fastify_1.default)({
        logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
        trustProxy: true,
    });
    await app.register(helmet_1.default, {
        contentSecurityPolicy: false, // API service — no HTML pages
    });
    await app.register(cors_1.default, {
        origin: resolveCorsOrigin(),
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        credentials: false,
    });
    await app.register(rate_limit_1.default, {
        max: RATE_LIMIT_PER_MIN,
        timeWindow: '1 minute',
        keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.ip,
        errorResponseBuilder: (_req, context) => ({
            statusCode: 429,
            error: 'Too Many Requests',
            message: `Rate limit exceeded. Retry in ${Math.ceil(context.ttl / 1000)}s`,
        }),
    });
    (0, auth_1.registerAuth)(app);
    await app.register(instrumentation_1.instrumentationPlugin);
    // ── Health probe ───────────────────────────────────────────────────────────
    app.get('/health', async () => ({
        status: 'ok',
        service: 'agent-decision-framework',
        version: '0.1.0',
        port: PORT,
        agentIdentityUrl: AGENT_IDENTITY_URL,
        policyCount: (0, policies_1.listPolicies)().length,
        persistenceFailures: (0, persistence_1.persistenceFailures)(),
        timestamp: new Date().toISOString(),
    }));
    // ── Metrics ────────────────────────────────────────────────────────────────
    app.get('/metrics', async (_req, reply) => {
        const { Metrics } = await Promise.resolve().then(() => __importStar(require('./lib/metrics.js')));
        reply.type('text/plain; version=0.0.4; charset=utf-8').send(await Metrics.register());
    });
    // ── Decision evaluation ────────────────────────────────────────────────────
    app.post('/v1/decisions/evaluate', async (req, reply) => {
        const parse = DecisionRequestSchema.safeParse(req.body);
        if (!parse.success) {
            return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
        }
        const request = parse.data;
        const agentPolicy = (0, policies_1.getAgentPolicy)(request.agentId);
        const policies = (0, policies_1.listPolicies)();
        const velocity = (0, velocity_1.getVelocity)(request.agentId);
        let reputation = null;
        if (request.counterpartyAgentId) {
            reputation = await (0, risk_scorer_1.fetchReputation)(AGENT_IDENTITY_URL, request.counterpartyAgentId);
        }
        const decision = (0, risk_scorer_1.decide)({ request, agentPolicy, policies, velocity, reputation });
        (0, decision_log_1.recordDecision)(decision);
        // Approved or pending decisions count toward velocity; rejects do not.
        if (decision.decision !== 'reject') {
            (0, velocity_1.recordTransaction)(request.agentId, request.amountUsd);
        }
        return reply.send({ data: decision });
    });
    // ── Global policy CRUD ─────────────────────────────────────────────────────
    app.get('/v1/policies', async (_req, reply) => {
        const all = (0, policies_1.listPolicies)();
        return reply.send({ data: all, total: all.length });
    });
    app.post('/v1/policies', async (req, reply) => {
        const parse = PolicyCreateSchema.safeParse(req.body);
        if (!parse.success) {
            return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
        }
        if ((0, policies_1.getPolicy)(parse.data.id)) {
            return reply.status(409).send({ error: 'Conflict', message: `Policy ${parse.data.id} already exists` });
        }
        const policy = (0, policies_1.addPolicy)(parse.data);
        return reply.status(201).send({ data: policy });
    });
    app.put('/v1/policies/:id', async (req, reply) => {
        const parse = PolicyUpdateSchema.safeParse(req.body);
        if (!parse.success) {
            return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
        }
        const updated = (0, policies_1.updatePolicy)(req.params.id, parse.data);
        if (!updated) {
            return reply.status(404).send({ error: 'NotFound', message: `Policy ${req.params.id} not found` });
        }
        return reply.send({ data: updated });
    });
    app.delete('/v1/policies/:id', async (req, reply) => {
        const deleted = (0, policies_1.deletePolicy)(req.params.id);
        if (!deleted) {
            return reply.status(404).send({ error: 'NotFound', message: `Policy ${req.params.id} not found` });
        }
        return reply.status(204).send();
    });
    // ── Per-agent policy ───────────────────────────────────────────────────────
    app.get('/v1/agents/:agentId/policy', async (req, reply) => {
        return reply.send({ data: (0, policies_1.getAgentPolicy)(req.params.agentId) });
    });
    app.put('/v1/agents/:agentId/policy', async (req, reply) => {
        const parse = AgentPolicyUpdateSchema.safeParse(req.body);
        if (!parse.success) {
            return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
        }
        const updated = (0, policies_1.setAgentPolicy)(req.params.agentId, parse.data);
        return reply.send({ data: updated });
    });
    // ── Velocity ───────────────────────────────────────────────────────────────
    app.get('/v1/agents/:agentId/velocity', async (req, reply) => {
        return reply.send({ data: (0, velocity_1.getVelocity)(req.params.agentId) });
    });
    // ── Decision history ───────────────────────────────────────────────────────
    app.get('/v1/decisions/history', async (req, reply) => {
        const limit = parseInt(req.query.limit ?? '50', 10);
        const data = (0, decision_log_1.getDecisionHistory)(Math.min(Math.max(limit, 1), 500));
        return reply.send({ data, total: data.length });
    });
    // ── Error handlers ─────────────────────────────────────────────────────────
    app.setErrorHandler((err, req, reply) => {
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
// ── Startup ───────────────────────────────────────────────────────────────────
async function main() {
    // Load policies, limits, spend windows and history before taking traffic (refuses to start in production without a database).
    await (0, persistence_1.initPersistence)();
    const app = await buildApp();
    const shutdown = async () => {
        app.log.info('[agent-decision] Shutting down...');
        await app.close();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    // ── Global error handlers (prevent silent pod crashes) ────────────────
    process.on('unhandledRejection', (reason, promise) => {
        app.log.error({ reason, promise }, 'Unhandled Rejection');
        process.exit(1);
    });
    process.on('uncaughtException', (error) => {
        app.log.error({ error }, 'Uncaught Exception');
        process.exit(1);
    });
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║       ForgePay Agent Decision Framework v0.1.0               ║
║       Listening on port ${PORT}                                 ║
║                                                              ║
║  Evaluate       →  POST /v1/decisions/evaluate               ║
║  Policies       →  GET  /v1/policies                         ║
║  Agent Policy   →  GET  /v1/agents/:agentId/policy           ║
║  Velocity       →  GET  /v1/agents/:agentId/velocity         ║
║  History        →  GET  /v1/decisions/history                ║
╚══════════════════════════════════════════════════════════════╝
`);
}
// Only auto-start when executed directly (not when imported by tests).
if (require.main === module) {
    main().catch((err) => {
        console.error('[agent-decision-framework] Fatal startup error:', err);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map
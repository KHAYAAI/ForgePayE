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
export declare function resolveCorsOrigin(): string | string[];
declare function buildApp(): Promise<import("fastify").FastifyInstance<import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, import("fastify").FastifyBaseLogger, import("fastify").FastifyTypeProviderDefault>>;
export { buildApp };
//# sourceMappingURL=index.d.ts.map
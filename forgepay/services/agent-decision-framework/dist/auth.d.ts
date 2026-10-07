/**
 * API-key authentication and scope enforcement for the Agent Decision
 * Framework.
 *
 * Before this module the service registered only helmet, cors and
 * rate-limit — every route was public, including policy CRUD and the
 * per-agent policy endpoints (risk tolerance, daily limit, counterparty
 * blocklist). Anyone who could reach port 3013 could silently loosen an
 * agent's policy (raise its daily limit, clear its blocklist) or read the
 * full decision audit log.
 *
 * Design decisions (adapted from agent-credit-bureau/src/auth.ts, which
 * this mirrors structurally, not verbatim):
 *
 *  - **Deny by default.** A global `onRequest` hook resolves the required
 *    scope from a table keyed on Fastify's *route pattern*. A route added
 *    later with no table entry requires `admin` rather than silently being
 *    public.
 *
 *  - **Keys are stored hashed.** Only sha256 digests are held in memory;
 *    raw keys live only in env vars / the secrets manager that injects them.
 *
 *  - **No multi-tenant ownership model.** Unlike the credit bureau (which
 *    gates furnishers to their own records), this service has no concept of
 *    a caller owning a particular agentId — `AgentPolicy` and the decision
 *    log are internal platform state, not another tenant's data. The
 *    callers are other ForgePay services (unified-router, mor-layer,
 *    agent-negotiation, the merchant dashboard, ...) asking "should this
 *    agent transaction go through?" and an operator/admin surface managing
 *    policy. So the scope model is flat and small:
 *
 *      - `evaluate` — call the risk engine (POST /v1/decisions/evaluate)
 *      - `read`     — read policies, an agent's policy, velocity, history
 *      - `admin`    — mutate global policies and per-agent policy overrides
 *
 *    Two key tiers hold these: a single admin key (all three scopes, used by
 *    the dashboard/ops) and a set of service keys (evaluate + read, used by
 *    internal callers that request decisions but should not be able to
 *    rewrite policy).
 */
import type { FastifyInstance } from 'fastify';
import { hashApiKey } from './hash';
export { hashApiKey };
export declare const SCOPES: {
    readonly EVALUATE: "evaluate";
    readonly READ: "read";
    readonly ADMIN: "admin";
};
export type Scope = (typeof SCOPES)[keyof typeof SCOPES];
export interface AuthContext {
    /** 'admin' for the operator key, otherwise a stable label for a service key. */
    principalId: string;
    kind: 'admin' | 'service';
    scopes: Set<string>;
}
declare module 'fastify' {
    interface FastifyRequest {
        auth?: AuthContext;
    }
}
/**
 * Resolve the operator/admin API key.
 *
 * @throws in production when ADF_ADMIN_API_KEY is missing, too short, or is
 *         still the development value. A policy engine that boots with a
 *         guessable admin key is worse than one that refuses to boot.
 */
export declare function getAdminKeyHash(): string;
/** Test helper — clears the memoised admin hash between cases. */
export declare function __resetAdminKeyCache(): void;
/**
 * Resolve the set of internal-service API keys from `ADF_SERVICE_API_KEYS`
 * (comma-separated). These authenticate other ForgePay services calling the
 * decision engine — they get `evaluate` + `read`, never `admin`.
 *
 * In production, any configured service key shorter than
 * `MIN_PRODUCTION_SERVICE_KEY_LENGTH` fails boot for the same reason a weak
 * admin key does: a trivially guessable internal credential is worse than an
 * absent one (no service keys configured simply means only the admin key
 * can call the API, which is a safe default, not a broken one).
 */
export declare function getServiceKeyHashes(): Map<string, string>;
/** Exposed so tests can assert the table covers every registered route. */
export declare function requiredScopeFor(method: string, pattern: string): Scope;
export declare function isPublicRoute(method: string, pattern: string): boolean;
/**
 * Register the global authorisation hook.
 *
 * Runs as `onRequest` so an unauthenticated caller is rejected before any
 * body parsing or handler work happens.
 */
export declare function registerAuth(app: FastifyInstance): void;
//# sourceMappingURL=auth.d.ts.map
/**
 * API-key authentication and per-agent ownership enforcement for the Agent
 * Liquidity Manager.
 *
 * Before this module the service registered only helmet, cors and
 * rate-limit — every route was public, including `POST
 * /v1/agents/:agentId/rebalance?execute=true` and `POST
 * /v1/agents/:agentId/sweep`, both of which actually move an agent's
 * balances (rebalance mutates tracked wallet state directly; sweep calls out
 * to the yield-engine and moves real funds into a vault). For a service that
 * moves money between assets, an open door here is the most severe form of
 * the gap.
 *
 * Design decisions (adapted from agent-credit-bureau/src/auth.ts):
 *
 *  - **Deny by default.** A global `onRequest` hook checks every route
 *    against a scope table keyed on the Fastify *route pattern*. A route
 *    added later with no table entry requires `admin` rather than silently
 *    being public — the failure mode of forgetting is a locked door, not an
 *    open one.
 *
 *  - **Keys are stored hashed.** Only sha256 digests are persisted (in
 *    memory — see store.ts); the raw key is returned once, at issue time,
 *    and never again.
 *
 *  - **Per-resource ownership.** The scope table only answers "may this
 *    principal act on liquidity-manager resources at all". Every route in
 *    this service is scoped under `/v1/agents/:agentId/...`, and a caller
 *    holding one agent's key must not be able to rebalance or sweep a
 *    *different* agent's portfolio just because both keys carry the same
 *    scope. `registerAuth()` therefore also enforces, centrally, that any
 *    route with an `:agentId` path parameter may only be acted on by the
 *    admin key or by that exact agent's own key — this is what closes the
 *    "any caller can sweep any agent's funds" hole, not just the "any caller
 *    can sweep" hole.
 *
 *  - **Bearer keys, not HMAC request signing.** Consistent with the bureau's
 *    reasoning: this is a credential-authorised API over TLS between
 *    internal ForgePay services / agent controllers, not a public payment
 *    rail. Money-movement safety here comes from ownership + scope checks,
 *    not per-request signatures.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { findAgentIdByKeyHash } from './store';
import { hashApiKey, safeEqualHex } from './hash';

export { hashApiKey };

// ── Scopes ────────────────────────────────────────────────────────────────────

export const SCOPES = {
  /** Act on a single agent's own portfolio (owner-checked per route). */
  AGENT: 'agent',
  /** Operator/platform key — acts on any agent, plus admin-only routes. */
  ADMIN: 'admin',
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

export interface AuthContext {
  /** 'admin' for the operator key, otherwise the owning agent's id. */
  principalId: string;
  kind: 'admin' | 'agent';
  scopes: Set<string>;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

// ── Admin key handling ───────────────────────────────────────────────────────

const DEV_ADMIN_KEY = 'dev-alm-admin-key';
const MIN_PRODUCTION_LENGTH = 32;

let cachedAdminHash: string | null = null;

/**
 * Resolve the operator/admin API key.
 *
 * @throws in production when ALM_ADMIN_API_KEY is missing, too short, or is
 *         still the development value. A money-movement service that boots
 *         with a guessable admin key is worse than one that refuses to boot.
 */
export function getAdminKeyHash(): string {
  if (cachedAdminHash) return cachedAdminHash;

  const key = process.env['ALM_ADMIN_API_KEY'];
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (isProduction) {
    if (!key) {
      throw new Error(
        'ALM_ADMIN_API_KEY is not set. The agent liquidity manager refuses to start in ' +
        'production without an operator key — generate one with `openssl rand -hex 32` ' +
        'and supply it via Vault or AWS Secrets Manager.',
      );
    }
    if (key === DEV_ADMIN_KEY) {
      throw new Error('ALM_ADMIN_API_KEY is set to the development value, which is public in this repository.');
    }
    if (key.length < MIN_PRODUCTION_LENGTH) {
      throw new Error(
        `ALM_ADMIN_API_KEY must be at least ${MIN_PRODUCTION_LENGTH} characters in production (got ${key.length}).`,
      );
    }
  }

  cachedAdminHash = hashApiKey(key || DEV_ADMIN_KEY);
  return cachedAdminHash;
}

/** Test helper — clears the memoised admin hash between cases. */
export function __resetAdminKeyCache(): void {
  cachedAdminHash = null;
}

// ── Per-resource ownership ───────────────────────────────────────────────────

/**
 * Does the caller own the agent named in the route?
 *
 * The scope table answers "may this principal call liquidity-manager routes
 * at all"; it cannot answer "may this principal rebalance/sweep *agent X's*
 * portfolio". Admin acts on any agent; an agent key acts only on itself.
 *
 * @returns null when authorised, or an error body to send with 403. A
 *          mismatch is 403 rather than 404: the caller authenticated fine,
 *          it simply may not act on that resource.
 */
export function agentAccessError(
  auth: AuthContext | undefined,
  routeAgentId: string,
): { error: string; message: string } | null {
  if (!auth) {
    return { error: 'Unauthorized', message: 'Missing authentication context.' };
  }
  if (auth.kind === 'admin') return null;
  if (auth.principalId === routeAgentId) return null;

  return {
    error: 'Forbidden',
    message: 'This key belongs to a different agent. A caller may only act on its own portfolio.',
  };
}

// ── Route → required scope ────────────────────────────────────────────────────

/** Routes served without credentials: liveness and the Prometheus scrape. */
const PUBLIC_ROUTES = new Set<string>([
  'GET /health',
  'GET /metrics',
]);

/**
 * Required scope per route pattern. Anything absent from this table requires
 * `admin` — see the deny-by-default note at the top of the file. Every route
 * here additionally goes through the per-agent ownership check in
 * `registerAuth()` because each one is parameterised by `:agentId`.
 */
const ROUTE_SCOPES: Record<string, Scope> = {
  'GET /v1/agents/:agentId/portfolio':               SCOPES.AGENT,

  'POST /v1/agents/:agentId/wallets':                SCOPES.AGENT,
  'PUT /v1/agents/:agentId/wallets/:walletId':        SCOPES.AGENT,

  'GET /v1/agents/:agentId/policy':                  SCOPES.AGENT,
  'PUT /v1/agents/:agentId/policy':                  SCOPES.AGENT,

  'GET /v1/agents/:agentId/target':                  SCOPES.AGENT,
  'PUT /v1/agents/:agentId/target':                  SCOPES.AGENT,

  // Money-movement routes.
  'POST /v1/agents/:agentId/rebalance':              SCOPES.AGENT,
  'POST /v1/agents/:agentId/sweep':                  SCOPES.AGENT,
  'POST /v1/agents/:agentId/liquidate':              SCOPES.AGENT,

  'GET /v1/agents/:agentId/history':                 SCOPES.AGENT,

  // Cross-agent aggregate — deliberately admin-only, not listed (falls
  // through to the default below), so `GET /v1/agent/summary` requires
  // `admin`.

  // Key issuance (`POST /v1/agents/:agentId/api-key`) is also deliberately
  // not listed: minting a credential for an agent is an admin action and
  // falls through to the default below.
};

function routeKey(method: string, pattern: string): string {
  return `${method.toUpperCase()} ${pattern}`;
}

/** Exposed so tests can assert the table covers every registered route. */
export function requiredScopeFor(method: string, pattern: string): Scope {
  return ROUTE_SCOPES[routeKey(method, pattern)] ?? SCOPES.ADMIN;
}

export function isPublicRoute(method: string, pattern: string): boolean {
  return PUBLIC_ROUTES.has(routeKey(method, pattern));
}

// ── Principal resolution ──────────────────────────────────────────────────────

/**
 * Resolve the presented credential to a principal.
 *
 * Accepts `Authorization: Bearer <key>` or `X-API-Key: <key>`. Returns null
 * if the credential is absent or unknown to this service.
 */
function resolvePrincipal(rawKey: string): AuthContext | null {
  const presented = hashApiKey(rawKey);

  if (safeEqualHex(presented, getAdminKeyHash())) {
    return {
      principalId: 'admin',
      kind: 'admin',
      scopes: new Set<string>(Object.values(SCOPES)),
    };
  }

  const agentId = findAgentIdByKeyHash(presented);
  if (agentId) {
    return {
      principalId: agentId,
      kind: 'agent',
      scopes: new Set<string>([SCOPES.AGENT]),
    };
  }

  return null;
}

function extractKey(req: FastifyRequest): string | null {
  const header = req.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim() || null;
  }
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }
  return null;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

/**
 * Register the global authorisation hook.
 *
 * Runs as `onRequest` so an unauthenticated caller is rejected before any
 * body parsing or handler work happens, and before any wallet/policy/target
 * state is touched.
 */
export function registerAuth(app: FastifyInstance): void {
  // Resolve (and validate) the admin key at registration time so a
  // production misconfiguration fails at boot rather than on first request.
  getAdminKeyHash();

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const pattern = req.routeOptions?.url;

    // No matching route — let Fastify's 404 handle it rather than leaking
    // whether a path exists via a 401/404 difference.
    if (!pattern) return;

    if (isPublicRoute(req.method, pattern)) return;

    const rawKey = extractKey(req);
    if (!rawKey) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Provide an API key via `Authorization: Bearer <key>` or `X-API-Key`.',
      });
    }

    const principal = resolvePrincipal(rawKey);
    if (!principal) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid API key.' });
    }

    const required = requiredScopeFor(req.method, pattern);
    if (!principal.scopes.has(required)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: `This key lacks the '${required}' scope.`,
      });
    }

    // Per-resource ownership: every route in this service is scoped by
    // :agentId. An agent-kind principal may only act on its own agentId;
    // admin may act on any.
    if (pattern.includes(':agentId')) {
      const routeAgentId = (req.params as Record<string, string> | undefined)?.['agentId'];
      if (routeAgentId) {
        const ownershipError = agentAccessError(principal, routeAgentId);
        if (ownershipError) {
          return reply.status(403).send(ownershipError);
        }
      }
    }

    req.auth = principal;
  });
}

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

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hashApiKey, safeEqualHex } from './hash';

export { hashApiKey };

// ── Scopes ────────────────────────────────────────────────────────────────────

export const SCOPES = {
  EVALUATE: 'evaluate',
  READ:     'read',
  ADMIN:    'admin',
} as const;

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

// ── Admin key ─────────────────────────────────────────────────────────────────

const DEV_ADMIN_KEY = 'dev-decision-framework-admin-key';
const MIN_PRODUCTION_LENGTH = 32;

let cachedAdminHash: string | null = null;

/**
 * Resolve the operator/admin API key.
 *
 * @throws in production when ADF_ADMIN_API_KEY is missing, too short, or is
 *         still the development value. A policy engine that boots with a
 *         guessable admin key is worse than one that refuses to boot.
 */
export function getAdminKeyHash(): string {
  if (cachedAdminHash) return cachedAdminHash;

  const key = process.env['ADF_ADMIN_API_KEY'];
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (isProduction) {
    if (!key) {
      throw new Error(
        'ADF_ADMIN_API_KEY is not set. The agent decision framework refuses to ' +
        'start in production without an operator key — generate one with ' +
        '`openssl rand -hex 32` and supply it via Vault or AWS Secrets Manager.',
      );
    }
    if (key === DEV_ADMIN_KEY) {
      throw new Error('ADF_ADMIN_API_KEY is set to the development value, which is public in this repository.');
    }
    if (key.length < MIN_PRODUCTION_LENGTH) {
      throw new Error(
        `ADF_ADMIN_API_KEY must be at least ${MIN_PRODUCTION_LENGTH} characters in production (got ${key.length}).`,
      );
    }
  }

  cachedAdminHash = hashApiKey(key || DEV_ADMIN_KEY);
  return cachedAdminHash;
}

/** Test helper — clears the memoised admin hash between cases. */
export function __resetAdminKeyCache(): void {
  cachedAdminHash = null;
  cachedServiceKeyHashes = null;
}

// ── Service keys ──────────────────────────────────────────────────────────────

const MIN_PRODUCTION_SERVICE_KEY_LENGTH = 20;

let cachedServiceKeyHashes: Map<string, string> | null = null;

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
export function getServiceKeyHashes(): Map<string, string> {
  if (cachedServiceKeyHashes) return cachedServiceKeyHashes;

  const raw = process.env['ADF_SERVICE_API_KEYS'] ?? '';
  const isProduction = process.env['NODE_ENV'] === 'production';
  const keys = raw.split(',').map(k => k.trim()).filter(Boolean);

  const hashes = new Map<string, string>();
  keys.forEach((key, index) => {
    if (isProduction && key.length < MIN_PRODUCTION_SERVICE_KEY_LENGTH) {
      throw new Error(
        `ADF_SERVICE_API_KEYS entry ${index + 1} is shorter than ` +
        `${MIN_PRODUCTION_SERVICE_KEY_LENGTH} characters, which is not ` +
        'permitted in production.',
      );
    }
    const hash = hashApiKey(key);
    hashes.set(hash, `service:${hash.slice(0, 8)}`);
  });

  cachedServiceKeyHashes = hashes;
  return hashes;
}

// ── Route → required scope ────────────────────────────────────────────────────

/** Routes served without credentials: liveness and the Prometheus scrape. */
const PUBLIC_ROUTES = new Set<string>([
  'GET /health',
  'GET /metrics',
]);

/**
 * Required scope per route pattern. Anything absent from this table requires
 * `admin` — see the deny-by-default note at the top of the file.
 */
const ROUTE_SCOPES: Record<string, Scope> = {
  // The risk engine itself — internal services asking for a decision.
  'POST /v1/decisions/evaluate':       SCOPES.EVALUATE,
  'GET /v1/decisions/history':         SCOPES.READ,

  // Global policy — reads are operationally useful to any authenticated
  // caller (e.g. a service wants to know what would apply); writes are
  // operator-only.
  'GET /v1/policies':                  SCOPES.READ,
  'POST /v1/policies':                 SCOPES.ADMIN,
  'PUT /v1/policies/:id':              SCOPES.ADMIN,
  'DELETE /v1/policies/:id':           SCOPES.ADMIN,

  // Per-agent policy — reads (e.g. a caller checking an agent's current
  // limits before proposing a transaction) vs. writes (raising a daily
  // limit, clearing a blocklist) get different scopes.
  'GET /v1/agents/:agentId/policy':    SCOPES.READ,
  'PUT /v1/agents/:agentId/policy':    SCOPES.ADMIN,

  // Velocity — read-only telemetry.
  'GET /v1/agents/:agentId/velocity':  SCOPES.READ,

  // Everything else falls through to admin by default and is deliberately
  // not listed.
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
 * Accepts `Authorization: Bearer <key>` or `X-Api-Key: <key>` (the
 * convention used across the other ForgePay services). Returns null if the
 * credential is absent or unknown.
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

  const serviceKeyHashes = getServiceKeyHashes();
  for (const [hash, principalId] of serviceKeyHashes) {
    if (safeEqualHex(presented, hash)) {
      return {
        principalId,
        kind: 'service',
        scopes: new Set<string>([SCOPES.EVALUATE, SCOPES.READ]),
      };
    }
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
 * body parsing or handler work happens.
 */
export function registerAuth(app: FastifyInstance): void {
  // Resolve (and validate) the admin + service keys at registration time so
  // a production misconfiguration fails at boot rather than on the first
  // request.
  getAdminKeyHash();
  getServiceKeyHashes();

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
        message: 'Provide an API key via `Authorization: Bearer <key>` or `X-Api-Key`.',
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

    req.auth = principal;
  });
}

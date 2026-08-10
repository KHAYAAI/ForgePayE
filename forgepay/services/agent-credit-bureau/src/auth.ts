/**
 * API-key authentication and scope enforcement for the Agent Credit Bureau.
 *
 * Before this module the service registered only helmet, cors and rate-limit.
 * Every route was public — including `POST /v1/agents/:agentId/events`, which
 * writes credit events, and `GET /v1/contributors/:id/stats`, which returned a
 * contributor's API key in plaintext to anyone who knew the id. For a credit
 * bureau that is the whole security model missing.
 *
 * Design decisions:
 *
 *  - **Deny by default.** Authorisation is a global `onRequest` hook driven by
 *    a scope table keyed on the Fastify *route pattern*, not a per-route
 *    `preHandler`. A route added later with no table entry requires `admin`
 *    rather than silently being public — the failure mode of forgetting is a
 *    locked door, not an open one.
 *
 *  - **Keys are stored hashed.** Only sha256 digests are persisted; the raw key
 *    is shown once at issue time and never again. This service previously kept
 *    `apiKey` in plaintext in memory and in Postgres (`data_contributors.api_key`).
 *
 *  - **Bearer keys, not HMAC request signing.** forge-custody signs every
 *    request because a forged custody call moves money. A bureau read is a
 *    credential-authorised query over TLS, which is what the incumbent bureaux
 *    use; per-request signing there would buy little and complicate every
 *    furnisher integration. Write paths are additionally scope-gated and, in
 *    the case of reports, consent-gated.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { contributors } from './store';
import { hashApiKey, safeEqualHex } from './hash';

// Re-exported so callers can keep importing it from the auth surface. The
// implementation lives in ./hash to keep store.ts out of an import cycle.
export { hashApiKey };

// ── Scopes ────────────────────────────────────────────────────────────────────

/**
 * Scope strings. The first two already existed as free-form values in
 * `DataContributor.permissions` on the seeded contributors, so they are kept
 * verbatim rather than renamed.
 */
export const SCOPES = {
  INGEST_EVENTS:   'ingest_events',
  PULL_SCORES:     'pull_scores',
  READ_PROFILE:    'read_profile',
  MANAGE_DISPUTES: 'manage_disputes',
  ADMIN:           'admin',
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

export interface AuthContext {
  /** 'admin' for the operator key, otherwise the contributor id. */
  principalId: string;
  kind: 'admin' | 'contributor';
  scopes: Set<string>;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

// ── Key handling ──────────────────────────────────────────────────────────────

const DEV_ADMIN_KEY = 'dev-bureau-admin-key';
const MIN_PRODUCTION_LENGTH = 32;

let cachedAdminHash: string | null = null;

/**
 * Resolve the operator/admin API key.
 *
 * @throws in production when BUREAU_ADMIN_API_KEY is missing, too short, or is
 *         still the development value. A credit bureau that boots with a
 *         guessable admin key is worse than one that refuses to boot.
 */
export function getAdminKeyHash(): string {
  if (cachedAdminHash) return cachedAdminHash;

  const key = process.env['BUREAU_ADMIN_API_KEY'];
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (isProduction) {
    if (!key) {
      throw new Error(
        'BUREAU_ADMIN_API_KEY is not set. The credit bureau refuses to start in ' +
        'production without an operator key — generate one with `openssl rand -hex 32` ' +
        'and supply it via Vault or AWS Secrets Manager.',
      );
    }
    if (key === DEV_ADMIN_KEY) {
      throw new Error('BUREAU_ADMIN_API_KEY is set to the development value, which is public in this repository.');
    }
    if (key.length < MIN_PRODUCTION_LENGTH) {
      throw new Error(
        `BUREAU_ADMIN_API_KEY must be at least ${MIN_PRODUCTION_LENGTH} characters in production (got ${key.length}).`,
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

/**
 * Strip key material before a contributor is serialised into any response.
 *
 * `GET /v1/contributors/:id/stats` previously returned the whole record —
 * including the plaintext API key — to an unauthenticated caller who knew the
 * contributor id, which made it a credential-disclosure endpoint.
 */
export function redactContributor<T extends { apiKeyHash?: string }>(c: T): Omit<T, 'apiKeyHash'> {
  const { apiKeyHash: _omitted, ...rest } = c;
  return rest;
}

/**
 * Per-resource authorisation: does the caller own the contributor in the path?
 *
 * The scope table answers "may this principal ingest at all"; it cannot answer
 * "may this principal ingest *as contributor X*". Nothing did — `req.auth` was
 * never read in any handler, and both contributor routes trusted
 * `req.params.id` alone. Any active furnisher could therefore write credit
 * events attributed to a competitor and read a competitor's volume and quota.
 *
 * Admin acts on any contributor; a furnisher acts only on itself.
 *
 * @returns null when authorised, or an error body to send with 403. A mismatch
 *          is 403 rather than 404: the caller authenticated fine, it simply may
 *          not act on that resource.
 */
export function contributorAccessError(
  auth: AuthContext | undefined,
  contributorId: string,
): { error: string; message: string } | null {
  if (!auth) {
    return { error: 'Unauthorized', message: 'Missing authentication context.' };
  }
  if (auth.kind === 'admin') return null;
  if (auth.principalId === contributorId) return null;

  return {
    error: 'Forbidden',
    message: 'This key belongs to a different contributor. A furnisher may only act on its own records.',
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
 * `admin` — see the deny-by-default note at the top of the file.
 */
const ROUTE_SCOPES: Record<string, Scope> = {
  // Agent profile and scoring — lender-facing reads.
  'GET /v1/agents':                          SCOPES.PULL_SCORES,
  'GET /v1/agents/:agentId/profile':         SCOPES.READ_PROFILE,
  'GET /v1/agents/:agentId/score':           SCOPES.PULL_SCORES,
  'GET /v1/agents/:agentId/dual-score':      SCOPES.PULL_SCORES,
  'GET /v1/agents/:agentId/history':         SCOPES.READ_PROFILE,
  'POST /v1/agents/:agentId/simulate':       SCOPES.PULL_SCORES,
  'POST /v1/agents/:agentId/verify':         SCOPES.PULL_SCORES,
  'POST /v1/verify/sanctions':               SCOPES.PULL_SCORES,
  'GET /v1/grade-scale':                     SCOPES.PULL_SCORES,
  'GET /v1/bureau/stats':                    SCOPES.PULL_SCORES,

  // Credit data writes — furnisher-facing.
  'POST /v1/agents/:agentId/profile':        SCOPES.INGEST_EVENTS,
  'POST /v1/agents/:agentId/events':         SCOPES.INGEST_EVENTS,
  'POST /v1/contributors/:id/ingest':        SCOPES.INGEST_EVENTS,
  'GET /v1/contributors/:id/stats':          SCOPES.INGEST_EVENTS,

  // Reports — a hard inquiry, lender-facing.
  'POST /v1/reports':                        SCOPES.PULL_SCORES,
  'GET /v1/reports/:reportId':               SCOPES.PULL_SCORES,
  'POST /v1/reports/:reportId/zk':           SCOPES.PULL_SCORES,

  // Disputes — the agent/operator side files, the bureau side resolves.
  'GET /v1/agents/:agentId/disputes':        SCOPES.READ_PROFILE,
  'POST /v1/agents/:agentId/disputes':       SCOPES.READ_PROFILE,
  'GET /v1/disputes':                        SCOPES.MANAGE_DISPUTES,
  'PUT /v1/disputes/:disputeId':             SCOPES.MANAGE_DISPUTES,

  // Everything else (contributor registration/activation, settlement) falls
  // through to admin by default and is deliberately not listed.
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
 * Accepts `Authorization: Bearer <key>` or `X-API-Key: <key>`. Returns null if
 * the credential is absent, unknown, or belongs to a contributor that is not
 * active — a suspended or still-pending furnisher authenticates as nobody.
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

  for (const contributor of contributors.values()) {
    if (!contributor.apiKeyHash) continue;
    if (!safeEqualHex(presented, contributor.apiKeyHash)) continue;

    // A key belonging to a pending or suspended contributor is not a
    // credential. Checked here rather than at the route so every path
    // inherits it.
    if (contributor.status !== 'active') return null;

    return {
      principalId: contributor.id,
      kind: 'contributor',
      scopes: new Set(contributor.permissions),
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
 * Runs as `onRequest` so an unauthenticated caller is rejected before any body
 * parsing or handler work happens.
 */
export function registerAuth(app: FastifyInstance): void {
  // Resolve (and validate) the admin key at registration time so a production
  // misconfiguration fails at boot rather than on the first request.
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
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or inactive API key.' });
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

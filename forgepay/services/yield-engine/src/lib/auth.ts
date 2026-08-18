/**
 * Merchant authentication for yield-engine.
 *
 * ── What was broken ─────────────────────────────────────────────────────────
 * 1. The global preHandler hook in index.ts called `req.jwtVerify()` but
 *    swallowed the failure ("we don't reject here because some routes are
 *    public") and never checked verification success anywhere else. A
 *    missing or invalid/expired Bearer token was silently accepted; `req.user`
 *    just stayed unset.
 * 2. `getMerchantId()` (duplicated in positions.ts, sweep.ts, yields.ts, and
 *    inline in index.ts's /api/v1/portfolio handler) fell back unconditionally
 *    to the client-supplied `x-merchant-id` header whenever `req.user` was
 *    unset — which, given (1), was every request without a valid JWT. Despite
 *    index.ts's docstring claiming this was a dev-only fallback, nothing in
 *    the code gated it on NODE_ENV or anything else. Any caller could set
 *    `x-merchant-id` to any value and read/mutate that merchant's positions,
 *    sweep config, and trigger `scheduleWithdrawal` for money that isn't
 *    theirs.
 *
 * ── Fix ──────────────────────────────────────────────────────────────────────
 * Merchant identity now comes exclusively from the `merchantId` claim of a
 * JWT verified with this service's own secret (`config.jwtSecret`). There is
 * no client-suppliable override of any kind.
 *
 * The `x-merchant-id` header is not gated behind an internal-service check —
 * it is removed outright. There is no evidence anywhere in this monorepo of a
 * legitimate service-to-service caller presenting that header to yield-engine
 * with its own authorization: config.ts defines no internal/service secret,
 * .env.example has none, and the only other services that talk to yield-engine
 * (agent-liquidity-manager/src/sweeper.ts, enterprise-treasury) call different,
 * unauthenticated placeholder endpoints (`/v1/sweep/trigger`, `/v1/sweep/withdraw`)
 * that don't exist on this service's actual router and don't send
 * `x-merchant-id` either. Per the task's own guidance: absent a real,
 * intentional internal-caller use case, removing the header-trust path
 * entirely is the safer fix.
 *
 * `registerMerchantAuth()` installs a deny-by-default gate: every route not
 * explicitly listed as public requires a valid Bearer JWT with a string
 * `merchantId` claim, or the request is rejected with 401 before it reaches
 * any handler. `getMerchantId()` then just reads that verified claim.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface MerchantJwtPayload {
  merchantId: string;
  [key: string]: unknown;
}

/**
 * Routes servable without a verified JWT: liveness/metrics probes and
 * read-only public catalogue data (vault list/detail/best, aggregate APYs)
 * that carries no merchant-specific information. Everything else is
 * deny-by-default — a new merchant-scoped route added later requires no
 * extra step to be protected; forgetting to list it here just means it's
 * (correctly) unreachable without auth.
 */
const PUBLIC_ROUTES: ReadonlyArray<{ method: string; matches: (path: string) => boolean }> = [
  { method: 'GET', matches: (p) => p === '/healthz' },
  { method: 'GET', matches: (p) => p === '/readyz' },
  { method: 'GET', matches: (p) => p === '/metrics' },
  { method: 'GET', matches: (p) => p === '/api/v1/vaults' || p.startsWith('/api/v1/vaults/') },
  { method: 'GET', matches: (p) => p === '/api/v1/yields/apys' },
];

function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some((r) => r.method === method && r.matches(path));
}

/**
 * Register the global merchant-auth gate. Must be registered after the
 * `@fastify/jwt` plugin (so `req.jwtVerify()` is available) and before the
 * route plugins are registered.
 *
 * Behaviour:
 *  - Public routes (see PUBLIC_ROUTES) skip auth entirely.
 *  - Everything else requires `Authorization: Bearer <token>`; a missing
 *    header, an invalid/expired token, or a token without a string
 *    `merchantId` claim all short-circuit with 401 — the handler never runs.
 */
export function registerMerchantAuth(app: FastifyInstance): void {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0] ?? req.url;
    if (isPublicRoute(req.method, path)) return;

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        error:   'Unauthorized',
        message: 'Missing bearer token.',
      });
    }

    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({
        error:   'Unauthorized',
        message: 'Invalid or expired token.',
      });
    }

    const merchantId = (req.user as MerchantJwtPayload | undefined)?.merchantId;
    if (typeof merchantId !== 'string' || merchantId.length === 0) {
      return reply.status(401).send({
        error:   'Unauthorized',
        message: 'Token missing merchantId claim.',
      });
    }

    return undefined;
  });
}

/**
 * Merchant identity for the current request — always the verified JWT's
 * `merchantId` claim, never a client-suppliable header. For any non-public
 * route this is guaranteed non-null once `registerMerchantAuth`'s hook has
 * run (it would already have rejected the request with 401 otherwise); this
 * still returns `string | null` defensively rather than asserting, so a
 * route can never be tricked into treating a missing claim as "unrestricted".
 */
export function getMerchantId(req: FastifyRequest): string | null {
  const merchantId = (req.user as MerchantJwtPayload | undefined)?.merchantId;
  return typeof merchantId === 'string' && merchantId.length > 0 ? merchantId : null;
}

/**
 * Customer authentication and route authorisation for unified-router.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What this unblocks
 *
 * `routes/bundle.ts`, `routes/csm.ts`, `routes/customer.ts` and
 * `middleware/require-product.ts` — 954 lines implementing product
 * entitlements, bundle upgrades, the CSM dashboard and upsell signals — all
 * read `request.user.customerId` and `request.user.tenantId`. Nothing ever
 * populated `request.user`, so every one of those handlers would have thrown a
 * TypeError on its first line. They were therefore left unregistered in
 * index.ts, and the entire three-product commercial motion was unreachable.
 *
 * This module is the missing half. It resolves a caller to a customer and
 * populates `request.user`, which is what those handlers already expect, so
 * they needed no rewriting.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Design, and where it deviates
 *
 * `types/fastify.d.ts` anticipated "a real JWT-verification preHandler". This
 * uses hashed bearer API keys instead, for a reason that only became clear from
 * the call sites: every caller of this service is another service —
 * chain-sync, stablecoin-gateway and forge-wallet all reach it over
 * UNIFIED_ROUTER_URL. Machine-to-machine callers carry no browser session, so
 * verifying a user JWT would mean inventing an issuer and coupling this service
 * to whichever app minted the token.
 *
 * The conventions here are lifted deliberately from
 * `agent-credit-bureau/src/auth.ts`, which is the most developed auth surface
 * in the platform:
 *
 *  - **Deny by default.** Authorisation is a global `onRequest` hook driven by
 *    a table keyed on the Fastify *route pattern*. A route added later with no
 *    table entry requires `admin` rather than being silently public. The
 *    failure mode of forgetting is a locked door.
 *
 *  - **Keys stored hashed.** Only sha256 digests are persisted.
 *
 *  - **Two principal kinds.** An operator key acts across all customers (the
 *    CSM dashboard is inherently cross-customer); a customer key acts only on
 *    itself. Scope alone cannot express "may act *as customer X*", so
 *    `customerAccessError` handles per-resource ownership separately — the same
 *    split the bureau uses for furnishers.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// `./db/index.js` reads config at module load and throws when POSTGRES_PASSWORD
// is absent, so importing it at the top would make the pure helpers below
// (hashing, comparison, ownership checks) untestable without a database
// password — and they have nothing to do with a database. It is imported lazily
// inside registerAuth, which is the only part that needs it.

// ── Key handling ──────────────────────────────────────────────────────────────

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Length-safe, constant-time comparison of two hex digests.
 *
 * Compares the digest *strings* as UTF-8 bytes rather than decoding them,
 * matching agent-credit-bureau/src/hash.ts. Decoding first looks tidier but is
 * a trap: `Buffer.from('zzzz', 'hex')` does not throw — Node silently returns
 * an empty buffer — so a decode-then-compare implementation quietly treats
 * malformed input as a zero-length digest. Comparing the raw characters has no
 * such edge, at the cost of 64 bytes rather than 32.
 */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const DEV_OPERATOR_KEY = 'dev-router-operator-key';
const MIN_PRODUCTION_LENGTH = 32;

let cachedOperatorHash: string | null = null;

/**
 * Resolve the operator/admin API key.
 *
 * @throws when NODE_ENV=production and ROUTER_OPERATOR_API_KEY is missing, too
 *         short, or still the development value. A router that boots with a
 *         guessable operator key hands over every customer's licensing state.
 */
export function getOperatorKeyHash(): string {
  if (cachedOperatorHash) return cachedOperatorHash;

  const key = process.env['ROUTER_OPERATOR_API_KEY'];

  if (process.env['NODE_ENV'] === 'production') {
    if (!key) {
      throw new Error(
        '[unified-router] ROUTER_OPERATOR_API_KEY is not set. Refusing to start in ' +
        'production without an operator key — generate one with `openssl rand -hex 32`.',
      );
    }
    if (key === DEV_OPERATOR_KEY) {
      throw new Error(
        '[unified-router] ROUTER_OPERATOR_API_KEY is still the development value, ' +
        'which is public in this repository. Refusing to start in production.',
      );
    }
    if (key.length < MIN_PRODUCTION_LENGTH) {
      throw new Error(
        `[unified-router] ROUTER_OPERATOR_API_KEY must be at least ${MIN_PRODUCTION_LENGTH} ` +
        `characters in production (got ${key.length}).`,
      );
    }
  }

  cachedOperatorHash = hashApiKey(key || DEV_OPERATOR_KEY);
  return cachedOperatorHash;
}

/** Test helper — clears the memoised operator hash between cases. */
export function __resetOperatorKeyCache(): void {
  cachedOperatorHash = null;
}

// ── Principal ─────────────────────────────────────────────────────────────────

export interface AuthContext {
  /** 'operator' for the platform key, otherwise the customer's UUID. */
  principalId: string;
  kind: 'operator' | 'customer';
  /** Null for the operator, which is not scoped to one tenant. */
  tenantId: string | null;
}

/**
 * Per-resource authorisation: may this caller act on the customer in the path?
 *
 * The route table answers "may this principal call this endpoint at all"; it
 * cannot answer "may it act *as customer X*". An operator acts on any customer;
 * a customer acts only on itself.
 *
 * @returns null when authorised, or a body to send with 403. A mismatch is 403
 *          rather than 404 — the caller authenticated fine, it simply may not
 *          act on that resource.
 */
export function customerAccessError(
  auth: AuthContext | undefined,
  customerId: string,
): { error: string; message: string } | null {
  if (!auth) {
    return { error: 'Unauthorized', message: 'Missing authentication context.' };
  }
  if (auth.kind === 'operator') return null;
  if (auth.principalId === customerId) return null;

  return {
    error: 'Forbidden',
    message: 'This key belongs to a different customer.',
  };
}

// ── Route table ───────────────────────────────────────────────────────────────

/** Served without credentials: liveness and the Prometheus scrape. */
const PUBLIC_ROUTES = new Set<string>([
  'GET /healthz',
  'GET /health',
  'GET /metrics',
]);

/**
 * Routes reachable by a customer key acting on itself. Anything not listed
 * here and not public requires the operator key — deny by default.
 *
 * Webhook endpoints are deliberately absent: they authenticate by HMAC over the
 * raw body (see routes/webhooks.ts and the rawBody parser in index.ts), not by
 * bearer key, so they are exempted structurally below rather than listed here.
 */
const CUSTOMER_ROUTES = new Set<string>([
  'GET /products',
  'POST /bundle/upgrade-to-bundle',
  'POST /v1/payments',
]);

/**
 * Webhook paths carry provider signatures, not customer keys. They are checked
 * by their own HMAC verification inside routes/webhooks.ts; applying bearer
 * auth here would reject every inbound provider callback.
 */
function isWebhookPath(url: string): boolean {
  return url.startsWith('/webhooks/');
}

// ── The hook ──────────────────────────────────────────────────────────────────

function bearerFrom(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();

  const alt = req.headers['x-api-key'];
  if (typeof alt === 'string' && alt.length > 0) return alt.trim();

  return null;
}

interface CustomerRow {
  id: string;
  tenant_id: string;
  status: string;
}

/**
 * Register authentication. Must run before the licensing routes are registered
 * so that `request.user` is populated by the time their handlers execute.
 */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  // Fail fast at boot rather than on the first authenticated request, so a
  // misconfigured production deploy never accepts traffic.
  getOperatorKeyHash();

  const { db } = await import('./db/index.js');
  const { logger } = await import('./lib/logger.js');

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const routeKey = `${req.method} ${req.routeOptions?.url ?? req.url}`;

    if (PUBLIC_ROUTES.has(routeKey) || isWebhookPath(req.url)) return;

    const presented = bearerFrom(req);
    if (!presented) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Provide an API key via `Authorization: Bearer <key>` or `X-API-Key`.',
      });
    }

    const presentedHash = hashApiKey(presented);

    // Operator key first — it is a single constant-time comparison and avoids a
    // database round trip for platform-internal calls.
    if (safeEqualHex(presentedHash, getOperatorKeyHash())) {
      req.auth = { principalId: 'operator', kind: 'operator', tenantId: null };
      req.user = { customerId: undefined, tenantId: undefined };
      return;
    }

    // Otherwise resolve to a customer by key hash.
    let row: CustomerRow | undefined;
    try {
      const result = await db.query<CustomerRow>(
        'public',
        `SELECT id, tenant_id, status FROM customers WHERE api_key_hash = $1 LIMIT 1`,
        [presentedHash],
      );
      row = result.rows[0];
    } catch (err) {
      // A lookup failure is not an authorisation success. Fail closed.
      logger.error({ err }, '[unified-router] customer key lookup failed');
      return reply.status(503).send({
        error: 'ServiceUnavailable',
        message: 'Authentication backend unavailable.',
      });
    }

    if (!row) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid API key.' });
    }

    if (row.status !== 'active') {
      return reply.status(403).send({
        error: 'Forbidden',
        message: `Customer account is ${row.status}.`,
      });
    }

    if (!CUSTOMER_ROUTES.has(routeKey)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'This endpoint requires an operator key.',
      });
    }

    req.auth = { principalId: row.id, kind: 'customer', tenantId: row.tenant_id };
    // The licensing handlers were written against `request.user`; populating it
    // is what lets bundle.ts / csm.ts / customer.ts mount unchanged.
    req.user = { customerId: row.id, tenantId: row.tenant_id };
  });
}

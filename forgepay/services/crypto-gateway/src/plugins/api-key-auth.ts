/**
 * API-key authentication and per-merchant ownership for crypto-gateway.
 *
 * ── Bug 1: fail-open production auth ──────────────────────────────────────────
 * The previous implementation read:
 *
 *   const validKeys = new Set((process.env['VALID_API_KEYS'] ?? '').split(',').filter(Boolean));
 *   if (!isDev && validKeys.size > 0 && !validKeys.has(apiKey)) return reply.code(401)...
 *
 * In production, if `VALID_API_KEYS` was never set, `validKeys.size > 0` is
 * false, so the whole guard collapses to "any non-empty key is accepted" —
 * fail OPEN exactly when the operator forgot to configure the one thing that
 * restricts access to a service that hands out deposit addresses and reports
 * on-chain payment status. Mirroring agent-negotiation's fixed
 * `api-key-auth.ts` (itself modelled on the credit bureau's
 * `getAdminKeyHash()`), this module now refuses to boot in production unless
 * `VALID_API_KEYS` is set to real (non-placeholder, sufficiently long) keys.
 * A service that fails to start is recoverable; one that silently accepts any
 * key is not.
 *
 * ── Bug 2: no per-merchant ownership ───────────────────────────────────────────
 * `VALID_API_KEYS` was (and for the admin/operator tier still is) a flat set
 * with no notion of which merchant presented the key, so any valid key could
 * read any other merchant's invoice by id, or list any merchant's invoices,
 * by simply supplying that merchant's id — the caller's identity was never
 * checked against the resource. There was no equivalent of the bureau's
 * `AuthContext.principalId` / `contributorAccessError`.
 *
 * This module adds:
 *   - `MERCHANT_API_KEYS` — a `merchantId:key,merchantId:key,...` map giving
 *     each key an identity (a merchant principal), analogous to
 *     agent-negotiation's `AGENT_API_KEYS` and the bureau's contributor keys.
 *   - An `admin` principal (`VALID_API_KEYS`) that, like the bureau's operator
 *     key, may act on any merchant's invoices — this is what internal
 *     platform services (e.g. mor-layer) use to create/read invoices on
 *     behalf of merchants they checkout for.
 *   - `invoiceAccessError`, the equivalent of `contributorAccessError`: a
 *     non-admin principal may only act on an invoice belonging to its own
 *     merchant id. A mismatch is 403 (authenticated fine, just not the
 *     owner), never 404.
 *
 * Dev/test ergonomics: when neither `VALID_API_KEYS` nor `MERCHANT_API_KEYS`
 * is configured and NODE_ENV isn't 'production', any non-empty key
 * authenticates as admin — preserving the "any key works in dev" behaviour
 * the existing test suite relies on. As soon as either variable is set (in
 * any environment), that permissive fallback turns off and keys must resolve
 * to a real principal.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

// ── Principal / auth context ───────────────────────────────────────────────────

export interface AuthContext {
  /** 'admin' for an operator key, otherwise the merchant id the key belongs to. */
  principalId: string;
  kind: 'admin' | 'merchant';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

// ── Key hashing ───────────────────────────────────────────────────────────────

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ── Admin keys (VALID_API_KEYS) ─────────────────────────────────────────────────

const DEV_PLACEHOLDER_KEY = 'dev-crypto-gateway-key';
const MIN_PRODUCTION_KEY_LENGTH = 32;

/**
 * Resolve the configured admin/operator keys.
 *
 * @throws in production when VALID_API_KEYS is missing, contains the
 *         development placeholder, or contains a key shorter than
 *         MIN_PRODUCTION_KEY_LENGTH. A payment gateway that boots with no
 *         real restriction on who can read invoices and deposit addresses is
 *         worse than one that refuses to boot.
 */
export function resolveAdminKeyHashes(): Set<string> {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const rawKeys = (process.env['VALID_API_KEYS'] ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  if (isProduction) {
    if (rawKeys.length === 0) {
      throw new Error(
        'VALID_API_KEYS is not set. crypto-gateway refuses to start in production without ' +
        'at least one admin API key — generate one with `openssl rand -hex 32` and supply it ' +
        'via Vault or AWS Secrets Manager.',
      );
    }
    for (const key of rawKeys) {
      if (key === DEV_PLACEHOLDER_KEY) {
        throw new Error('VALID_API_KEYS contains the development placeholder key, which is public in this repository.');
      }
      if (key.length < MIN_PRODUCTION_KEY_LENGTH) {
        throw new Error(
          `Every key in VALID_API_KEYS must be at least ${MIN_PRODUCTION_KEY_LENGTH} characters in production (got ${key.length}).`,
        );
      }
    }
  }

  return new Set(rawKeys.map(hashKey));
}

// ── Merchant identity keys (MERCHANT_API_KEYS) ──────────────────────────────────

/**
 * Parse `MERCHANT_API_KEYS` — a comma-separated `merchantId:key` list — into a
 * hash(key) → merchantId map. This is what gives a presented credential an
 * identity to check invoice ownership against; nothing did before.
 */
export function resolveMerchantKeyMap(): Map<string, string> {
  const raw = (process.env['MERCHANT_API_KEYS'] ?? '').trim();
  const map = new Map<string, string>();
  if (!raw) return map;

  for (const pair of raw.split(',')) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const merchantId = pair.slice(0, idx).trim();
    const key = pair.slice(idx + 1).trim();
    if (!merchantId || !key) continue;
    map.set(hashKey(key), merchantId);
  }
  return map;
}

// ── Credential extraction ────────────────────────────────────────────────────

function extractKey(request: FastifyRequest): string | null {
  const xApiKey = request.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.trim()) return xApiKey.trim();

  const authHeader = request.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const value = authHeader.slice(7).trim();
    return value || null;
  }
  return null;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

/**
 * Register the global authentication hook.
 *
 * Called directly (not via `app.register`) so a production misconfiguration
 * throws synchronously while the app is being assembled, rather than on the
 * first request — the same shape as agent-negotiation's `registerApiKeyAuth`
 * and the bureau's `registerAuth`.
 */
export function registerApiKeyAuth(app: FastifyInstance): void {
  const adminKeyHashes = resolveAdminKeyHashes();
  const merchantKeyMap = resolveMerchantKeyMap();
  const isProduction = process.env['NODE_ENV'] === 'production';
  // Only when nothing has been configured at all do we fall back to "any
  // non-empty key is admin" — the moment either variable is set, callers must
  // resolve to a real principal. This never fires in production because
  // resolveAdminKeyHashes() above already throws when VALID_API_KEYS is unset.
  const permissiveDevFallback = !isProduction && adminKeyHashes.size === 0 && merchantKeyMap.size === 0;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for health endpoint
    if (request.url === '/health' || request.url.startsWith('/health') || request.url.startsWith('/healthz') || request.url.startsWith('/readyz') || request.url.startsWith('/metrics')) return;

    const apiKey = extractKey(request);
    if (!apiKey) {
      return reply.code(401).send({
        error:   'Unauthorized',
        message: 'Missing API key. Provide it via X-Api-Key or Authorization: Bearer <key>.',
      });
    }

    const presented = hashKey(apiKey);

    for (const hash of adminKeyHashes) {
      if (safeEqualHex(presented, hash)) {
        request.auth = { principalId: 'admin', kind: 'admin' };
        return;
      }
    }

    const merchantId = merchantKeyMap.get(presented);
    if (merchantId) {
      request.auth = { principalId: merchantId, kind: 'merchant' };
      return;
    }

    if (permissiveDevFallback) {
      request.auth = { principalId: 'admin', kind: 'admin' };
      return;
    }

    return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid API key.' });
  });
}

// ── Per-resource ownership ────────────────────────────────────────────────────

/**
 * Does the caller own this invoice?
 *
 * The auth hook answers "is this a known key"; it cannot answer "may this
 * principal act on invoice X". Nothing did before — the GET-by-id and list
 * routes trusted the path/query alone, so any valid key could read any other
 * merchant's invoice (deposit address, amount, status) by id, or list any
 * merchant's invoices wholesale by passing its merchant_id.
 *
 * Admin acts on any invoice; a merchant acts only on invoices with a matching
 * `merchant_id`.
 *
 * @returns null when authorised, or an error body to send with 403 — a
 *          mismatch is 403, not 404: the caller authenticated fine, it simply
 *          doesn't own this invoice.
 */
export function invoiceAccessError(
  auth: AuthContext | undefined,
  invoiceMerchantId: string,
): { error: string; message: string } | null {
  if (!auth) return { error: 'Unauthorized', message: 'Missing authentication context.' };
  if (auth.kind === 'admin') return null;
  if (auth.principalId === invoiceMerchantId) return null;

  return {
    error:   'Forbidden',
    message: 'This key does not belong to the merchant that owns this invoice.',
  };
}

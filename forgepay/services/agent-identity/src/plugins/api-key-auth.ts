/**
 * API-key authentication and per-resource ownership for agent-identity.
 *
 * ── Bug 1: fail-open production auth ──────────────────────────────────────────
 * The previous implementation read:
 *
 *   const VALID_API_KEYS = new Set((process.env['API_KEYS'] ?? '').split(',').filter(Boolean));
 *   if (!isDev && VALID_API_KEYS.size > 0 && !VALID_API_KEYS.has(apiKey)) return reply.code(403)...
 *
 * In production, if the key list was never configured, `VALID_API_KEYS.size > 0`
 * is false, so the whole guard collapses to "any non-empty key is accepted" —
 * fail OPEN exactly when the operator forgot to configure the one thing that
 * restricts access. It also read from `API_KEYS`, while every piece of this
 * platform's infra (`forgepay/infra/vault/*`) provisions `VALID_API_KEYS` —
 * so in a real deployment the guard was reading a variable that was never
 * set, permanently. Mirroring the credit bureau's `getAdminKeyHash()`
 * (agent-credit-bureau/src/auth.ts) and agent-negotiation's
 * `resolveAdminKeyHashes()`, this module now refuses to boot in production
 * unless `VALID_API_KEYS` is set to real (non-placeholder, sufficiently long)
 * keys. A service that fails to start is recoverable; one that silently
 * accepts any key is not.
 *
 * ── Bug 2: no per-resource ownership ───────────────────────────────────────────
 * API keys were a flat set with no notion of who presented the key, so any
 * valid key could read or mutate ANY agent's identity, reputation, or
 * attestation record — including issuing a KYAPay token for someone else's
 * agent. This service is the platform's DID registry: agent-credit-bureau's
 * `identity_bound` check and agent-decision-framework's counterparty
 * reputation lookup both treat it as the source of truth, so an unauthorised
 * mutation here corrupts trust signals every other service relies on.
 *
 * This module adds:
 *   - `MERCHANT_API_KEYS` — a `merchantId:key,merchantId:key,...` map giving
 *     each key an identity: the `ownerMerchantId` already used on
 *     `AgentIdentity` (see types.ts) to record who registered an agent. This
 *     is the same "owning principal" concept forge-wallet calls
 *     `ownerPlatform` — we reuse this service's own field instead of
 *     inventing a parallel one.
 *   - An `admin` principal (`VALID_API_KEYS`) that, like the bureau's and
 *     negotiation's operator keys, may act on any resource — this is what
 *     internal platform services (agent-decision-framework's
 *     `AGENT_IDENTITY_API_KEY`, agent-credit-bureau's identity check, etc.)
 *     are expected to hold, since they legitimately need to look up
 *     arbitrary agents.
 *   - `agentAccessError`, the equivalent of `contributorAccessError` /
 *     `negotiationAccessError`: a non-admin principal may only read or
 *     mutate an agent it is the `ownerMerchantId` of. A mismatch is 403
 *     (authenticated fine, just doesn't own that agent), never 404.
 *
 * Dev/test ergonomics: when neither `VALID_API_KEYS` nor `MERCHANT_API_KEYS`
 * is configured and NODE_ENV isn't 'production', any non-empty key
 * authenticates as admin — preserving the "any key works in dev" behaviour
 * the existing test suite relies on. As soon as either variable is set (in
 * any environment), that permissive fallback turns off and keys must resolve
 * to a real principal.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AgentIdentity } from '../types';

// ── Principal / auth context ─────────────────────────────────────────────────

export interface AuthContext {
  /** 'admin' for an operator key, otherwise the ownerMerchantId the key belongs to. */
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

// ── Admin keys (VALID_API_KEYS) ──────────────────────────────────────────────

const DEV_PLACEHOLDER_KEY = 'dev-identity-key';
const MIN_PRODUCTION_KEY_LENGTH = 32;

/**
 * Resolve the configured admin/operator keys.
 *
 * @throws in production when VALID_API_KEYS is missing, contains the
 *         development placeholder, or contains a key shorter than
 *         MIN_PRODUCTION_KEY_LENGTH. A DID registry that boots with no real
 *         restriction on who can mutate identity/reputation records is worse
 *         than one that refuses to boot.
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
        'VALID_API_KEYS is not set. agent-identity refuses to start in production without ' +
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

// ── Merchant/owner keys (MERCHANT_API_KEYS) ──────────────────────────────────

/**
 * Parse `MERCHANT_API_KEYS` — a comma-separated `merchantId:key` list — into
 * a hash(key) → ownerMerchantId map. This is what gives a presented
 * credential an identity to check `AgentIdentity.ownerMerchantId` against;
 * nothing did before.
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

// Routes that don't require auth
const PUBLIC_ROUTES = ['/health', '/v1/discover', '/v1/verify-signature', '/.well-known/jwks.json'];

// ── Plugin ────────────────────────────────────────────────────────────────────

async function apiKeyAuthPlugin(fastify: FastifyInstance): Promise<void> {
  const adminKeyHashes = resolveAdminKeyHashes();
  const merchantKeyMap = resolveMerchantKeyMap();
  const isProduction = process.env['NODE_ENV'] === 'production';
  // Only when nothing has been configured at all do we fall back to "any
  // non-empty key is admin" — the moment either variable is set, callers must
  // resolve to a real principal. This never fires in production because
  // resolveAdminKeyHashes() above already throws when VALID_API_KEYS is unset.
  const permissiveDevFallback = !isProduction && adminKeyHashes.size === 0 && merchantKeyMap.size === 0;

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? request.url;

    // Skip auth for public routes
    if (PUBLIC_ROUTES.some((r) => path === r || path.startsWith(r))) {
      return;
    }

    const apiKey = extractKey(request);
    if (!apiKey) {
      reply.code(401).send({ error: 'Missing API key. Provide X-Api-Key header.' });
      return;
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

    reply.code(403).send({ error: 'Invalid API key.' });
  });
}

export default fastifyPlugin(apiKeyAuthPlugin);

// ── Per-resource ownership ────────────────────────────────────────────────────

/**
 * Does the caller own this agent identity?
 *
 * The auth hook answers "is this a known key"; it cannot answer "may this
 * principal act on agent X". Nothing did before — every agent/reputation/
 * attestation route trusted `req.params.id` alone, so any valid key could
 * read or mutate any agent's identity or reputation record, including one
 * belonging to a competing merchant.
 *
 * Admin acts on any agent; a merchant principal acts only on agents it is
 * the `ownerMerchantId` of.
 *
 * @returns null when authorised, or an error body to send with 403 — a
 *          mismatch is 403, not 404: the caller authenticated fine, it
 *          simply doesn't own this agent identity.
 */
export function agentAccessError(
  auth: AuthContext | undefined,
  agent: Pick<AgentIdentity, 'ownerMerchantId'>,
): { error: string; message: string } | null {
  if (!auth) return { error: 'Unauthorized', message: 'Missing authentication context.' };
  if (auth.kind === 'admin') return null;
  if (auth.principalId === agent.ownerMerchantId) return null;

  return {
    error: 'Forbidden',
    message: 'This key does not own this agent identity.',
  };
}

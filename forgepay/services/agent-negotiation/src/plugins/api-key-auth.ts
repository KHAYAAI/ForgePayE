/**
 * API-key authentication and per-resource ownership for agent-negotiation.
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
 * restricts access. Mirroring the credit bureau's `getAdminKeyHash()`
 * (agent-credit-bureau/src/auth.ts), this module now refuses to boot in
 * production unless `VALID_API_KEYS` is set to real (non-placeholder,
 * sufficiently long) keys. A service that fails to start is recoverable; one
 * that silently accepts any key is not.
 *
 * ── Bug 2: no per-resource ownership ───────────────────────────────────────────
 * `VALID_API_KEYS` was a flat set with no notion of which agent presented the
 * key, so any valid key could read or mutate any negotiation session or
 * escrow — including one belonging to two other agents entirely. There was no
 * equivalent of the bureau's `AuthContext.principalId` / `contributorAccessError`.
 *
 * This module adds:
 *   - `AGENT_API_KEYS` — a `agentId:key,agentId:key,...` map giving each key an
 *     identity (an agent principal), analogous to a contributor's api key in
 *     the bureau.
 *   - An `admin` principal (`VALID_API_KEYS`) that, like the bureau's operator
 *     key, may act on any resource.
 *   - `negotiationAccessError` / `escrowAccessError`, the equivalents of
 *     `contributorAccessError`: a non-admin principal may only act on a
 *     session/escrow it is a party to. A mismatch is 403 (authenticated fine,
 *     just not a party to that resource), never 404.
 *
 * Dev/test ergonomics: when neither `VALID_API_KEYS` nor `AGENT_API_KEYS` is
 * configured and NODE_ENV isn't 'production', any non-empty key authenticates
 * as admin — preserving the "any key works in dev" behaviour the existing
 * test suite relies on. As soon as either variable is set (in any
 * environment), that permissive fallback turns off and keys must resolve to a
 * real principal.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Escrow, NegotiationSession } from '../types';

// ── Principal / auth context ───────────────────────────────────────────────────

export interface AuthContext {
  /** 'admin' for an operator key, otherwise the agent id the key belongs to. */
  principalId: string;
  kind: 'admin' | 'agent';
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

const DEV_PLACEHOLDER_KEY = 'dev-negotiation-key';
const MIN_PRODUCTION_KEY_LENGTH = 32;

/**
 * Resolve the configured admin/operator keys.
 *
 * @throws in production when VALID_API_KEYS is missing, contains the
 *         development placeholder, or contains a key shorter than
 *         MIN_PRODUCTION_KEY_LENGTH. A negotiation/escrow service that boots
 *         with no real restriction on who can move funds is worse than one
 *         that refuses to boot.
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
        'VALID_API_KEYS is not set. agent-negotiation refuses to start in production without ' +
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

// ── Agent identity keys (AGENT_API_KEYS) ────────────────────────────────────────

/**
 * Parse `AGENT_API_KEYS` — a comma-separated `agentId:key` list — into a
 * hash(key) → agentId map. This is what gives a presented credential an
 * identity to check resource ownership against; nothing did before.
 */
export function resolveAgentKeyMap(): Map<string, string> {
  const raw = (process.env['AGENT_API_KEYS'] ?? '').trim();
  const map = new Map<string, string>();
  if (!raw) return map;

  for (const pair of raw.split(',')) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const agentId = pair.slice(0, idx).trim();
    const key = pair.slice(idx + 1).trim();
    if (!agentId || !key) continue;
    map.set(hashKey(key), agentId);
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
 * throws synchronously while `buildApp()` is being assembled, rather than on
 * the first request — the same shape as the bureau's `registerAuth`.
 */
export function registerApiKeyAuth(app: FastifyInstance): void {
  const adminKeyHashes = resolveAdminKeyHashes();
  const agentKeyMap = resolveAgentKeyMap();
  const isProduction = process.env['NODE_ENV'] === 'production';
  // Only when nothing has been configured at all do we fall back to "any
  // non-empty key is admin" — the moment either variable is set, callers must
  // resolve to a real principal. This never fires in production because
  // resolveAdminKeyHashes() above already throws when VALID_API_KEYS is unset.
  const permissiveDevFallback = !isProduction && adminKeyHashes.size === 0 && agentKeyMap.size === 0;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for health endpoint
    if (request.url === '/health' || request.url.startsWith('/health')) return;

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

    const agentId = agentKeyMap.get(presented);
    if (agentId) {
      request.auth = { principalId: agentId, kind: 'agent' };
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
 * Does the caller belong to this negotiation session?
 *
 * The auth hook answers "is this a known key"; it cannot answer "may this
 * principal act on session X". Nothing did before — every session/message
 * route trusted the path/body alone, so any valid key could read or drive
 * (via a forged `fromAgentId`) a negotiation between two other agents.
 *
 * Admin acts on any session; an agent acts only on sessions it is the
 * initiator or responder of.
 *
 * @returns null when authorised, or an error body to send with 403 — a
 *          mismatch is 403, not 404: the caller authenticated fine, it simply
 *          isn't a party to this negotiation.
 */
export function negotiationAccessError(
  auth: AuthContext | undefined,
  session: Pick<NegotiationSession, 'initiatorAgentId' | 'responderAgentId'>,
): { error: string; message: string } | null {
  if (!auth) return { error: 'Unauthorized', message: 'Missing authentication context.' };
  if (auth.kind === 'admin') return null;
  if (auth.principalId === session.initiatorAgentId || auth.principalId === session.responderAgentId) return null;

  return {
    error:   'Forbidden',
    message: 'This key does not belong to a party in this negotiation.',
  };
}

/**
 * Does the caller belong to this escrow? Same shape as
 * `negotiationAccessError`, checked against the escrow's buyer/seller instead
 * of a session's initiator/responder — this is what closes the hole where any
 * valid key could fund/release/refund/dispute an escrow between two other
 * agents.
 */
export function escrowAccessError(
  auth: AuthContext | undefined,
  escrow: Pick<Escrow, 'buyerAgentId' | 'sellerAgentId'>,
): { error: string; message: string } | null {
  if (!auth) return { error: 'Unauthorized', message: 'Missing authentication context.' };
  if (auth.kind === 'admin') return null;
  if (auth.principalId === escrow.buyerAgentId || auth.principalId === escrow.sellerAgentId) return null;

  return {
    error:   'Forbidden',
    message: 'This key does not belong to a party in this escrow.',
  };
}

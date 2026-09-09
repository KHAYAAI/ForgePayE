"use strict";
/**
 * API-key authentication and per-resource ownership for rwa-registry.
 *
 * ── Bug 1: fail-open production auth ────────────────────────────────────────
 * The previous implementation read:
 *
 *   const validKeys = new Set((process.env['VALID_API_KEYS'] ?? '').split(',').filter(Boolean));
 *   if (!isDev && validKeys.size > 0 && !validKeys.has(apiKey)) return reply.code(401)...
 *
 * In production, if `VALID_API_KEYS` was never set, `validKeys.size > 0` is
 * false, so the whole guard collapses to "any non-empty key is accepted" —
 * fail OPEN exactly when the operator forgot to configure the one thing that
 * restricts access to tokenized T-bill/money-market positions. Mirroring
 * agent-credit-bureau's `getAdminKeyHash()` (agent-credit-bureau/src/auth.ts)
 * and agent-negotiation's `resolveAdminKeyHashes()`, this module now refuses
 * to boot in production unless `VALID_API_KEYS` is set to real (non-placeholder,
 * sufficiently long) keys.
 *
 * ── Bug 2: no per-resource ownership ─────────────────────────────────────────
 * `VALID_API_KEYS` was a flat set with no notion of which merchant presented
 * the key, so any valid key could read or mutate any merchant's RWA position
 * or redemption request — including opening/redeeming units, reading NAV/cost
 * basis, or cancelling a pending redemption — purely by varying the
 * `:id`/`merchantId` in the request. There was no equivalent of the bureau's
 * `AuthContext.principalId` / `contributorAccessError`.
 *
 * This module adds:
 *   - `MERCHANT_API_KEYS` — a `merchantId:key,merchantId:key,...` map giving
 *     each key an identity (a merchant principal).
 *   - An `admin` principal (`VALID_API_KEYS`) that, like the bureau's operator
 *     key, may act on any resource (used by internal jobs/ops tooling).
 *   - `merchantAccessError`, the equivalent of `contributorAccessError`: a
 *     non-admin principal may only act on positions/redemptions/income that
 *     belong to it. A mismatch is 403 (authenticated fine, just not the
 *     owner), never 404.
 *
 * Dev/test ergonomics: when neither `VALID_API_KEYS` nor `MERCHANT_API_KEYS`
 * is configured and NODE_ENV isn't 'production', any non-empty key
 * authenticates as admin — preserving the "any key works in dev" behaviour
 * the existing test suite relies on. As soon as either variable is set (in
 * any environment), that permissive fallback turns off and keys must resolve
 * to a real principal.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAdminKeyHashes = resolveAdminKeyHashes;
exports.resolveMerchantKeyMap = resolveMerchantKeyMap;
exports.registerApiKeyAuth = registerApiKeyAuth;
exports.merchantAccessError = merchantAccessError;
const node_crypto_1 = require("node:crypto");
// ── Key hashing ───────────────────────────────────────────────────────────────
function hashKey(raw) {
    return (0, node_crypto_1.createHash)('sha256').update(raw).digest('hex');
}
function safeEqualHex(a, b) {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length)
        return false;
    return (0, node_crypto_1.timingSafeEqual)(bufA, bufB);
}
// ── Admin keys (VALID_API_KEYS) ─────────────────────────────────────────────────
const DEV_PLACEHOLDER_KEY = 'dev-rwa-registry-key';
const MIN_PRODUCTION_KEY_LENGTH = 32;
/**
 * Resolve the configured admin/operator keys.
 *
 * @throws in production when VALID_API_KEYS is missing, contains the
 *         development placeholder, or contains a key shorter than
 *         MIN_PRODUCTION_KEY_LENGTH. A registry of tokenized T-bill/money-
 *         market positions that boots with no real restriction on who can
 *         open, read, or redeem a position is worse than one that refuses to
 *         boot.
 */
function resolveAdminKeyHashes() {
    const isProduction = process.env['NODE_ENV'] === 'production';
    const rawKeys = (process.env['VALID_API_KEYS'] ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    if (isProduction) {
        if (rawKeys.length === 0) {
            throw new Error('VALID_API_KEYS is not set. rwa-registry refuses to start in production without ' +
                'at least one admin API key — generate one with `openssl rand -hex 32` and supply it ' +
                'via Vault or AWS Secrets Manager.');
        }
        for (const key of rawKeys) {
            if (key === DEV_PLACEHOLDER_KEY) {
                throw new Error('VALID_API_KEYS contains the development placeholder key, which is public in this repository.');
            }
            if (key.length < MIN_PRODUCTION_KEY_LENGTH) {
                throw new Error(`Every key in VALID_API_KEYS must be at least ${MIN_PRODUCTION_KEY_LENGTH} characters in production (got ${key.length}).`);
            }
        }
    }
    return new Set(rawKeys.map(hashKey));
}
// ── Merchant identity keys (MERCHANT_API_KEYS) ──────────────────────────────────
/**
 * Parse `MERCHANT_API_KEYS` — a comma-separated `merchantId:key` list — into a
 * hash(key) → merchantId map. This is what gives a presented credential an
 * identity to check resource ownership against; nothing did before.
 */
function resolveMerchantKeyMap() {
    const raw = (process.env['MERCHANT_API_KEYS'] ?? '').trim();
    const map = new Map();
    if (!raw)
        return map;
    for (const pair of raw.split(',')) {
        const idx = pair.indexOf(':');
        if (idx === -1)
            continue;
        const merchantId = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        if (!merchantId || !key)
            continue;
        map.set(hashKey(key), merchantId);
    }
    return map;
}
// ── Credential extraction ────────────────────────────────────────────────────
function extractKey(request) {
    const xApiKey = request.headers['x-api-key'];
    if (typeof xApiKey === 'string' && xApiKey.trim())
        return xApiKey.trim();
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
function registerApiKeyAuth(app) {
    const adminKeyHashes = resolveAdminKeyHashes();
    const merchantKeyMap = resolveMerchantKeyMap();
    const isProduction = process.env['NODE_ENV'] === 'production';
    // Only when nothing has been configured at all do we fall back to "any
    // non-empty key is admin" — the moment either variable is set, callers must
    // resolve to a real principal. This never fires in production because
    // resolveAdminKeyHashes() above already throws when VALID_API_KEYS is unset.
    const permissiveDevFallback = !isProduction && adminKeyHashes.size === 0 && merchantKeyMap.size === 0;
    app.addHook('onRequest', async (request, reply) => {
        // Skip auth for health endpoint
        if (request.url === '/health' || request.url.startsWith('/health'))
            return;
        const apiKey = extractKey(request);
        if (!apiKey) {
            return reply.code(401).send({
                error: 'Unauthorized',
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
 * Does the caller own this merchant-scoped resource (position, redemption
 * request, income record)?
 *
 * The auth hook answers "is this a known key"; it cannot answer "may this
 * principal act on merchant X's data". Nothing did before — every position
 * and redemption route trusted the path/query/body `merchantId` alone, so any
 * valid key could read another merchant's position/cost-basis/NAV or drive
 * (via a forged `merchantId` or by varying `:id`) a redemption belonging to a
 * merchant it has no relationship with.
 *
 * Admin acts on any merchant's data; a merchant key acts only on its own.
 *
 * @returns null when authorised, or an error body to send with 403 — a
 *          mismatch is 403, not 404: the caller authenticated fine, it simply
 *          doesn't own this resource.
 */
function merchantAccessError(auth, merchantId) {
    if (!auth)
        return { error: 'Unauthorized', message: 'Missing authentication context.' };
    if (auth.kind === 'admin')
        return null;
    if (auth.principalId === merchantId)
        return null;
    return {
        error: 'Forbidden',
        message: 'This key does not belong to the merchant that owns this resource.',
    };
}
//# sourceMappingURL=api-key-auth.js.map
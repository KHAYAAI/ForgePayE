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
import type { FastifyInstance } from 'fastify';
export interface AuthContext {
    /** 'admin' for an operator key, otherwise the merchantId the key belongs to. */
    principalId: string;
    kind: 'admin' | 'merchant';
}
declare module 'fastify' {
    interface FastifyRequest {
        auth?: AuthContext;
    }
}
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
export declare function resolveAdminKeyHashes(): Set<string>;
/**
 * Parse `MERCHANT_API_KEYS` — a comma-separated `merchantId:key` list — into a
 * hash(key) → merchantId map. This is what gives a presented credential an
 * identity to check resource ownership against; nothing did before.
 */
export declare function resolveMerchantKeyMap(): Map<string, string>;
/**
 * Register the global authentication hook.
 *
 * Called directly (not via `app.register`) so a production misconfiguration
 * throws synchronously while `buildApp()` is being assembled, rather than on
 * the first request — the same shape as the bureau's `registerAuth`.
 */
export declare function registerApiKeyAuth(app: FastifyInstance): void;
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
export declare function merchantAccessError(auth: AuthContext | undefined, merchantId: string): {
    error: string;
    message: string;
} | null;
//# sourceMappingURL=api-key-auth.d.ts.map
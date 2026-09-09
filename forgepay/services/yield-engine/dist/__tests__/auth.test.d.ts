/**
 * Auth regression tests for yield-engine.
 *
 * Covers the fix for two bugs found in review:
 *  1. The global JWT preHandler verified the token but swallowed any
 *     verification failure, so a missing/invalid token never actually
 *     blocked a request.
 *  2. getMerchantId() (duplicated across positions.ts, sweep.ts, yields.ts,
 *     and index.ts's /api/v1/portfolio) fell back unconditionally to the
 *     client-supplied `x-merchant-id` header, letting any caller act as any
 *     merchant — including scheduling withdrawals on positions they don't own.
 *
 * These tests assert:
 *  - Requests with no token, or an invalid token, are rejected with 401
 *    before reaching a handler.
 *  - A valid JWT for merchant A cannot read or mutate merchant B's
 *    positions/sweep config/withdrawals via a spoofed `x-merchant-id`
 *    header — merchant identity always comes from the token, never the
 *    header.
 *  - Public routes (health probes, vault catalogue, /yields/apys) remain
 *    reachable without a token.
 */
export {};
//# sourceMappingURL=auth.test.d.ts.map
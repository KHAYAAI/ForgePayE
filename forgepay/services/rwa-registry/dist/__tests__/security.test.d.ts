/**
 * Security regression tests for rwa-registry.
 *
 * Covers three fixes:
 *   1. Production auth fails closed when VALID_API_KEYS is missing/placeholder/
 *      too short, instead of silently accepting any non-empty key
 *      (`validKeys.size > 0` collapsing to false was the original bug).
 *   2. Production boot fails when CORS_ORIGIN is unset or still '*'.
 *   3. Per-merchant ownership: a merchant-scoped key may only read/mutate its
 *      own positions and redemption requests — not another merchant's, by
 *      varying `:id` or `merchantId`.
 */
export {};
//# sourceMappingURL=security.test.d.ts.map
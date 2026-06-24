/**
 * Integration tests for RWA Registry NAV Pricing persistence layer.
 *
 * Tests verify:
 * - Write-through caching: fresh prices cached in PostgreSQL
 * - Fallback to cached price when API fails
 * - 1-hour TTL expiration
 * - Graceful degradation on rate limit / API errors
 * - Service doesn't crash under adverse conditions
 *
 * Uses vitest + supertest-style mocking.
 */
export {};
//# sourceMappingURL=nav.test.d.ts.map
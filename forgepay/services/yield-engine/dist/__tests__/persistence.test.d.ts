/**
 * Integration tests for Yield Engine position persistence layer.
 *
 * Tests verify:
 * - Write-through caching: positions persist to DB and in-memory cache
 * - Positions survive pod restart (initPositionsFromDb)
 * - Write-through on updateAPY(), withdrawFromVault()
 * - Graceful degradation when DB unavailable
 * - ON CONFLICT idempotency (no duplicate writes)
 *
 * Uses vitest + real PostgreSQL connection (testcontainers or local).
 */
export {};
//# sourceMappingURL=persistence.test.d.ts.map
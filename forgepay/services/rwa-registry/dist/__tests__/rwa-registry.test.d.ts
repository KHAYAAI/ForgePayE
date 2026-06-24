/**
 * Integration tests for the RWA (Real-World Assets) Registry service.
 *
 * Uses Fastify's built-in app.inject() to exercise HTTP routes without
 * binding to a real port. The apiKeyAuth plugin allows any non-empty
 * key in non-production mode, so all non-health requests carry 'x-api-key'.
 *
 * Asset IDs are UUID-based (generated at module-load time in store.ts),
 * so we discover them via GET /v1/assets in beforeAll.
 */
export {};
//# sourceMappingURL=rwa-registry.test.d.ts.map
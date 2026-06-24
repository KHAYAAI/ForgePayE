import type { FastifyInstance } from 'fastify';
/**
 * Validates X-Api-Key or Authorization: Bearer header.
 * In development (NODE_ENV !== 'production'), any non-empty key passes.
 * In production, key is validated against VALID_API_KEYS env var (comma-separated).
 */
declare function apiKeyAuthPlugin(app: FastifyInstance): Promise<void>;
declare const _default: typeof apiKeyAuthPlugin;
export default _default;
//# sourceMappingURL=api-key-auth.d.ts.map
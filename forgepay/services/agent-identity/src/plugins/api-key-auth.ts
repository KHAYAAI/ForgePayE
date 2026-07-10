/**
 * API Key Authentication Plugin
 * ─────────────────────────────────────────────────────────────────────────
 * Fastify plugin for request-scoped API key validation.
 * Checks X-Api-Key (or Authorization: Bearer <key>) header — matches the
 * convention used across the other ForgePay services (see e.g.
 * rwa-registry/src/plugins/api-key-auth.ts).
 *
 * In development (NODE_ENV !== 'production') any non-empty key is accepted
 * — this still requires *a* key to be present so "missing auth" tests
 * exercise the real code path, unlike the previous behavior of skipping
 * auth entirely whenever API_KEYS wasn't configured.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

const VALID_API_KEYS = new Set(
  (process.env['API_KEYS'] ?? '').split(',').filter(Boolean),
);

// Routes that don't require auth
const PUBLIC_ROUTES = ['/health', '/v1/discover', '/v1/verify-signature', '/.well-known/jwks.json'];

async function apiKeyAuthPlugin(fastify: FastifyInstance): Promise<void> {
  const isDev = process.env['NODE_ENV'] !== 'production';

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? request.url;

    // Skip auth for public routes
    if (PUBLIC_ROUTES.some((r) => path === r || path.startsWith(r))) {
      return;
    }

    const apiKey =
      (request.headers['x-api-key'] as string | undefined) ??
      (request.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '');

    if (!apiKey) {
      reply.code(401).send({ error: 'Missing API key. Provide X-Api-Key header.' });
      return;
    }

    if (!isDev && VALID_API_KEYS.size > 0 && !VALID_API_KEYS.has(apiKey)) {
      reply.code(403).send({ error: 'Invalid API key.' });
      return;
    }
  });
}

export default fastifyPlugin(apiKeyAuthPlugin);

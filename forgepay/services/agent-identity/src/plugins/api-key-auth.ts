/**
 * API Key Authentication Plugin
 * ─────────────────────────────────────────────────────────────────────────
 * Fastify plugin for request-scoped API key validation.
 * Checks Authorization: Bearer <key> header.
 */

import type { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

const VALID_API_KEYS = (process.env['API_KEYS'] ?? '').split(',').filter(Boolean);

// Routes that don't require auth
const PUBLIC_ROUTES = ['/health', '/v1/discover', '/v1/verify-signature', '/.well-known/jwks.json'];

async function apiKeyAuthPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', async (request) => {
    const path = request.url.split('?')[0];

    // Skip auth for public routes
    if (PUBLIC_ROUTES.some((r) => path === r || path.startsWith(r))) {
      return;
    }

    // Skip auth if no API_KEYS configured (dev mode)
    if (!VALID_API_KEYS.length) {
      return;
    }

    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw fastify.httpErrors.unauthorized('Missing or invalid Authorization header');
    }

    const key = authHeader.slice(7); // Remove "Bearer "
    if (!VALID_API_KEYS.includes(key)) {
      throw fastify.httpErrors.forbidden('Invalid API key');
    }
  });
}

export default fastifyPlugin(apiKeyAuthPlugin);

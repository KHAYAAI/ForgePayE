/**
 * Fastify Instrumentation Plugin — agent-identity
 *
 * Hooks into Fastify request/response lifecycle to:
 *   - Track HTTP request duration and status
 *   - Normalize routes (UUIDs → {uuid}, DIDs → {did}, IDs → {id})
 */

import { FastifyPlugin, FastifyRequest, FastifyReply } from 'fastify';
import { recordHttpRequest } from './metrics';

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const DID_REGEX = /did:[a-z]+:[a-zA-Z0-9-]+/gi;

/**
 * Normalize route path by replacing dynamic segments
 */
function normalizeRoute(path: string): string {
  let normalized = path.replace(DID_REGEX, '{did}');
  normalized = normalized.replace(UUID_REGEX, '{uuid}');
  return normalized;
}

/**
 * Fastify plugin to instrument HTTP metrics
 */
const instrumentationPlugin: FastifyPlugin = async (fastify) => {
  fastify.addHook('onRequest', async (req: FastifyRequest) => {
    // Attach start time to request
    (req as any).startTime = Date.now();
  });

  fastify.addHook(
    'onResponse',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const startTime = (req as any).startTime ?? Date.now();
      const durationMs = Date.now() - startTime;
      const normalizedRoute = normalizeRoute(req.url);

      recordHttpRequest({
        method: req.method,
        route: normalizedRoute,
        statusCode: reply.statusCode,
        durationMs,
      });
    }
  );
};

export default instrumentationPlugin;

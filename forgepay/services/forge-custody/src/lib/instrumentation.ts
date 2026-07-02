/**
 * Fastify plugin for HTTP request instrumentation
 *
 * Tracks request duration and counts for all routes, with automatic route
 * normalization (UUIDs → {uuid}, numeric IDs → {id}, prefixed IDs → {id}).
 *
 * Usage:
 *   await app.register(instrumentationPlugin);
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { httpRequestDuration, httpRequestTotal } from './metrics';

/**
 * Normalize route paths for consistent metric labels
 * Examples:
 *   /api/v1/signing/123e4567-e89b-12d3-a456-426614174000 → /api/v1/signing/{uuid}
 *   /api/v1/keys/42 → /api/v1/keys/{id}
 *   /api/v1/signing/sr_abc123/approve → /api/v1/signing/{id}/approve
 */
function normalizeRoute(path: string): string {
  return path
    // Replace UUID patterns (8-4-4-4-12 hex chars)
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/{uuid}')
    // Replace numeric IDs
    .replace(/\/\d+(?=\/|$)/g, '/{id}')
    // Replace service-specific prefixed IDs
    .replace(/\/(ws|ak|pol|key|cer|sr|apr|shr)_[a-zA-Z0-9]+(?=\/|$)/gi, '/{id}');
}

/**
 * Fastify plugin for HTTP instrumentation
 */
export async function instrumentationPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest, _reply: FastifyReply) => {
    (req as FastifyRequest & { startTime?: number }).startTime = Date.now();
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = (req as FastifyRequest & { startTime?: number }).startTime ?? Date.now();
    const durationSeconds = (Date.now() - startTime) / 1000;
    const route = normalizeRoute(req.url.split('?')[0] ?? req.url);
    const labels = {
      method:      req.method,
      route,
      status_code: String(reply.statusCode),
    };
    httpRequestDuration.observe(labels, durationSeconds);
    httpRequestTotal.inc(labels);
  });
}

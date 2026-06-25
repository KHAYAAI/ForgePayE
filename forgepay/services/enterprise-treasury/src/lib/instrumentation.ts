/**
 * Fastify plugin for HTTP request instrumentation
 *
 * Tracks request duration and counts for all routes, with automatic route
 * normalization (UUIDs → {uuid}, numeric IDs → {id}).
 *
 * Usage:
 *   await app.register(instrumentationPlugin);
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { httpRequestDuration, httpRequestTotal } from './metrics';

/**
 * Normalize route paths for consistent metric labels
 * Examples:
 *   /v1/rules/123e4567-e89b-12d3-a456-426614174000 → /v1/rules/{uuid}
 *   /v1/rules/42 → /v1/rules/{id}
 *   /v1/netting/flows/nf_abc123 → /v1/netting/flows/{id}
 */
function normalizeRoute(path: string): string {
  return path
    // Replace UUID patterns (8-4-4-4-12 hex chars)
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/{uuid}')
    // Replace numeric IDs
    .replace(/\/\d+(?=\/|$)/g, '/{id}')
    // Replace service-specific IDs
    .replace(/\/(rule|flow|approval|settlement)_[a-zA-Z0-9_]+(?=\/|$)/gi, '/{id}');
}

/**
 * Fastify plugin for HTTP instrumentation
 */
export async function instrumentationPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Store request start time for latency calculation
    (req as any).startTime = Date.now();
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = (req as any).startTime as number;
    const duration = (Date.now() - startTime) / 1000; // Convert to seconds

    const method = req.method;
    const route = normalizeRoute(req.url);
    const statusCode = reply.statusCode.toString();

    // Record histogram and counter metrics
    httpRequestDuration.labels(method, route, statusCode).observe(duration);
    httpRequestTotal.labels(method, route, statusCode).inc();
  });
}

/**
 * Fastify instrumentation plugin for HTTP metrics.
 * Tracks request duration and counts by method, route, and status code.
 * Normalizes routes by replacing UUIDs with {uuid} and numeric IDs with {id}.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { httpRequestDuration, httpRequestTotal } from './metrics';

// ── Route normalization ───────────────────────────────────────────────────────

/**
 * Normalize a URL path by replacing UUIDs and numeric IDs with placeholders.
 * Examples:
 *   /api/v1/positions/550e8400-e29b-41d4-a716-446655440000 → /api/v1/positions/{uuid}
 *   /api/v1/vaults/123 → /api/v1/vaults/{id}
 *   /api/v1/vaults/123/positions/456 → /api/v1/vaults/{id}/positions/{id}
 */
function normalizeRoute(path: string): string {
  let normalized = path;

  // Replace UUIDs (8-4-4-4-12 hex pattern)
  normalized = normalized.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '{uuid}',
  );

  // Replace numeric IDs (one or more digits)
  normalized = normalized.replace(/\/\d+\//g, '/{id}/');
  normalized = normalized.replace(/\/\d+$/g, '/{id}');

  return normalized;
}

// ── Fastify plugin ────────────────────────────────────────────────────────────

interface InstrumentationOptions {
  // Optional custom route normalizer function
  normalizer?: (path: string) => string;
}

export async function instrumentationPlugin(
  fastify: FastifyInstance,
  options?: InstrumentationOptions,
): Promise<void> {
  const normalizer = options?.normalizer ?? normalizeRoute;

  // Track request start time
  fastify.addHook('onRequest', async (req: FastifyRequest) => {
    req.startTime = Date.now();
  });

  // Record metrics on response
  fastify.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const elapsed = (Date.now() - (req.startTime ?? Date.now())) / 1000; // seconds
    const normalizedRoute = normalizer(req.url);
    const statusCode = reply.statusCode.toString();

    httpRequestDuration.labels(req.method, normalizedRoute, statusCode).observe(elapsed);
    httpRequestTotal.labels(req.method, normalizedRoute, statusCode).inc();
  });
}

// Augment FastifyRequest type to include startTime
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
  }
}

export default instrumentationPlugin;

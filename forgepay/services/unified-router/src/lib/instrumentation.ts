/**
 * Fastify instrumentation plugin for Prometheus metrics.
 *
 * Tracks:
 *   - Request duration (onRequest start time, onResponse end time)
 *   - Request count
 *   - HTTP method, route path, and status code labels
 *
 * The plugin respects Fastify 5.x lifecycle hooks and properly records
 * metrics in the onResponse hook to ensure accurate timing.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { httpRequestDuration, httpRequestTotal, register } from './metrics.js';

export { register };

const REQUEST_START_TIME = Symbol('RequestStartTime');

export async function registerInstrumentationPlugin(app: FastifyInstance) {
  // Track request start time
  app.addHook('onRequest', async (req: FastifyRequest) => {
    (req as any)[REQUEST_START_TIME] = Date.now();
  });

  // Record metrics on response
  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = (req as any)[REQUEST_START_TIME];
    if (!startTime) return;

    const endTime = Date.now();
    const durationMs = endTime - startTime;
    const durationSeconds = durationMs / 1000;

    // Normalize route path — remove UUIDs and dynamic segments to avoid cardinality explosion
    const route = normalizeRoute(req.url);
    const method = req.method;
    const statusCode = String(reply.statusCode);

    // Record histogram and counter
    httpRequestDuration.labels(method, route, statusCode).observe(durationSeconds);
    httpRequestTotal.labels(method, route, statusCode).inc();
  });
}

/**
 * Normalize route path to avoid metric cardinality explosion.
 * Replaces UUIDs and numeric IDs with placeholders.
 *
 * Examples:
 *   /webhooks/hyperswitch  → /webhooks/hyperswitch
 *   /events/550e8400-e29b-41d4-a716-446655440000  → /events/{uuid}
 *   /events/123  → /events/{id}
 */
function normalizeRoute(url: string): string {
  // Remove query string
  const path = url.split('?')[0];

  // Replace UUIDs (standard format)
  const withoutUuids = path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '{uuid}',
  );

  // Replace numeric IDs (but not in service names like /events)
  const withoutIds = withoutUuids.replace(/\/\d+(?=\/|$)/g, '/{id}');

  return withoutIds;
}

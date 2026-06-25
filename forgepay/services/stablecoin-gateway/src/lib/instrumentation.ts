import type { FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { httpRequestDuration, httpRequestTotal } from './metrics.js';

// Route normalizer: replace UUIDs with {uuid}, numeric IDs with {id}
function normalizeRoute(path: string): string {
  // Replace UUID pattern (8-4-4-4-12 hex)
  let normalized = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}');

  // Replace numeric IDs
  normalized = normalized.replace(/\/\d+(?=\/|$)/g, '/{id}');

  return normalized;
}

export default fp(async (fastify) => {
  fastify.addHook('onRequest', async (req: FastifyRequest) => {
    // Store request start time for duration calculation
    (req as any)._startTime = Date.now();
  });

  fastify.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = (req as any)._startTime || Date.now();
    const duration = (Date.now() - startTime) / 1000; // Convert to seconds

    const method = req.method;
    const route = normalizeRoute(req.url.split('?')[0]); // Remove query params
    const statusCode = reply.statusCode.toString();

    // Record metrics
    httpRequestDuration.labels(method, route, statusCode).observe(duration);
    httpRequestTotal.labels(method, route, statusCode).inc();
  });
});

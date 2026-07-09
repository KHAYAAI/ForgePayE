import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { httpRequestDuration, httpRequestTotal } from './metrics.js';

interface RequestContext {
  startTime?: number;
}

declare global {
  namespace FastifyInstance {
    interface FastifyInstance {
      _requestContext?: Map<string, RequestContext>;
    }
  }
}

/**
 * Fastify instrumentation plugin for Prometheus metrics.
 * Tracks HTTP request latency and counts by method, route, and status code.
 */
const instrumentationPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (req: FastifyRequest, _reply: FastifyReply) => {
    // Store request start time for latency calculation
    (req as any).startTime = Date.now();
  });

  fastify.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = (req as any).startTime as number | undefined;
    if (!startTime) return;

    const durationMs = Date.now() - startTime;
    const durationSec = durationMs / 1000;

    // Normalize route path to avoid cardinality explosion
    const route = normalizeRoute(req.url, req.routeOptions?.url || req.url);
    const method = req.method;
    const statusCode = reply.statusCode.toString();

    // Record HTTP request duration
    httpRequestDuration
      .labels(method, route, statusCode)
      .observe(durationSec);

    // Increment HTTP request counter
    httpRequestTotal
      .labels(method, route, statusCode)
      .inc();
  });
};

/**
 * Normalize route path by replacing path parameters with placeholders.
 * E.g., /v1/positions/abc123 → /v1/positions/:id
 */
function normalizeRoute(url: string, routerPath: string): string {
  // Use routerPath if available (contains parameter placeholders)
  if (routerPath && routerPath !== url) {
    return routerPath;
  }

  // Fallback: basic normalization for dynamic segments
  const parts = url.split('/');
  return parts
    .map((part) => {
      // Check if part looks like a UUID or alphanumeric ID
      if (/^[a-f0-9\-]{20,}$|^\d{10,}$/.test(part)) {
        return ':id';
      }
      return part;
    })
    .join('/');
}

export default fp(instrumentationPlugin, { name: 'instrumentation' });

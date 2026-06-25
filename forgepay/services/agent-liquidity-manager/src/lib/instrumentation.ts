import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { metrics } from './metrics.js';

/**
 * Normalize route paths for metrics
 * - Replace UUIDs with {uuid}
 * - Replace numeric IDs with {id}
 * - Preserve template variables
 */
function normalizeRoute(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
    .replace(/\/\d+(?=\/|$)/g, '/{id}');
}

/**
 * Fastify plugin for HTTP instrumentation
 */
export async function instrumentationPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    (req as any).startTime = Date.now();
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = (req as any).startTime as number;
    const duration = (Date.now() - startTime) / 1000; // Convert to seconds

    const route = normalizeRoute(req.url);
    const statusCode = reply.statusCode.toString();

    metrics.httpRequestDuration.observe(
      {
        method: req.method,
        route,
        status_code: statusCode,
      },
      duration
    );

    metrics.httpRequestTotal.inc({
      method: req.method,
      route,
      status_code: statusCode,
    });
  });
}

export default instrumentationPlugin;

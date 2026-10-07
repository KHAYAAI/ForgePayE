import fp from 'fastify-plugin';
import { httpRequestDuration, httpRequestTotal } from './metrics.js';
/**
 * Fastify instrumentation plugin for Prometheus metrics.
 * Tracks HTTP request latency and counts by method, route, and status code.
 */
const instrumentationPlugin = async (fastify) => {
    fastify.addHook('onRequest', async (req, _reply) => {
        // Store request start time for latency calculation
        req.startTime = Date.now();
    });
    fastify.addHook('onResponse', async (req, reply) => {
        const startTime = req.startTime;
        if (!startTime)
            return;
        const durationMs = Date.now() - startTime;
        const durationSec = durationMs / 1000;
        // Normalize route path to avoid cardinality explosion
        const route = normalizeRoute(req.url, req.routeOptions.url || req.url);
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
 * E.g., /v1/reports/abc123 → /v1/reports/:id
 */
function normalizeRoute(url, routerPath) {
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
//# sourceMappingURL=instrumentation.js.map
"use strict";
/**
 * Fastify instrumentation plugin for HTTP metrics.
 * Tracks request duration and counts by method, route, and status code.
 * Normalizes routes by replacing UUIDs with {uuid} and numeric IDs with {id}.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.instrumentationPlugin = instrumentationPlugin;
const metrics_1 = require("./metrics");
// ── Route normalization ───────────────────────────────────────────────────────
/**
 * Normalize a URL path by replacing UUIDs and numeric IDs with placeholders.
 * Examples:
 *   /api/v1/positions/550e8400-e29b-41d4-a716-446655440000 → /api/v1/positions/{uuid}
 *   /api/v1/vaults/123 → /api/v1/vaults/{id}
 *   /api/v1/vaults/123/positions/456 → /api/v1/vaults/{id}/positions/{id}
 */
function normalizeRoute(path) {
    let normalized = path;
    // Replace UUIDs (8-4-4-4-12 hex pattern)
    normalized = normalized.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}');
    // Replace numeric IDs (one or more digits)
    normalized = normalized.replace(/\/\d+\//g, '/{id}/');
    normalized = normalized.replace(/\/\d+$/g, '/{id}');
    return normalized;
}
async function instrumentationPlugin(fastify, options) {
    const normalizer = options?.normalizer ?? normalizeRoute;
    // Track request start time
    fastify.addHook('onRequest', async (req) => {
        req.startTime = Date.now();
    });
    // Record metrics on response
    fastify.addHook('onResponse', async (req, reply) => {
        const elapsed = (Date.now() - (req.startTime ?? Date.now())) / 1000; // seconds
        const normalizedRoute = normalizer(req.url);
        const statusCode = reply.statusCode.toString();
        metrics_1.httpRequestDuration.labels(req.method, normalizedRoute, statusCode).observe(elapsed);
        metrics_1.httpRequestTotal.labels(req.method, normalizedRoute, statusCode).inc();
    });
}
exports.default = instrumentationPlugin;
//# sourceMappingURL=instrumentation.js.map
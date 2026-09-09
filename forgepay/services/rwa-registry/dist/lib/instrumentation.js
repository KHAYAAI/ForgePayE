"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const metrics_js_1 = require("./metrics.js");
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
        const route = normalizeRoute(req.url, req.routeOptions?.url || req.url);
        const method = req.method;
        const statusCode = reply.statusCode.toString();
        // Record HTTP request duration
        metrics_js_1.httpRequestDuration
            .labels(method, route, statusCode)
            .observe(durationSec);
        // Increment HTTP request counter
        metrics_js_1.httpRequestTotal
            .labels(method, route, statusCode)
            .inc();
    });
};
/**
 * Normalize route path by replacing path parameters with placeholders.
 * E.g., /v1/positions/abc123 → /v1/positions/:id
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
exports.default = (0, fastify_plugin_1.default)(instrumentationPlugin, { name: 'instrumentation' });
//# sourceMappingURL=instrumentation.js.map
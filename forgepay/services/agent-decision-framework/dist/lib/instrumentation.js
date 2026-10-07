"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.instrumentationPlugin = instrumentationPlugin;
const metrics_js_1 = require("./metrics.js");
/**
 * Normalize route paths for metrics
 * - Replace UUIDs with {uuid}
 * - Replace numeric IDs with {id}
 * - Preserve template variables
 */
function normalizeRoute(path) {
    return path
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
        .replace(/\/\d+(?=\/|$)/g, '/{id}');
}
/**
 * Fastify plugin for HTTP instrumentation
 */
async function instrumentationPlugin(app) {
    app.addHook('onRequest', async (req) => {
        req.startTime = Date.now();
    });
    app.addHook('onResponse', async (req, reply) => {
        const startTime = req.startTime;
        const duration = (Date.now() - startTime) / 1000; // Convert to seconds
        const route = normalizeRoute(req.url);
        const statusCode = reply.statusCode.toString();
        metrics_js_1.metrics.httpRequestDuration.observe({
            method: req.method,
            route,
            status_code: statusCode,
        }, duration);
        metrics_js_1.metrics.httpRequestTotal.inc({
            method: req.method,
            route,
            status_code: statusCode,
        });
    });
}
exports.default = instrumentationPlugin;
//# sourceMappingURL=instrumentation.js.map
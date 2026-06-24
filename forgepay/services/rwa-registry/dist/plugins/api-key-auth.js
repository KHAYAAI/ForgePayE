"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
/**
 * Validates X-Api-Key or Authorization: Bearer header.
 * In development (NODE_ENV !== 'production'), any non-empty key passes.
 * In production, key is validated against VALID_API_KEYS env var (comma-separated).
 */
async function apiKeyAuthPlugin(app) {
    const isDev = process.env['NODE_ENV'] !== 'production';
    const validKeys = new Set((process.env['VALID_API_KEYS'] ?? '').split(',').filter(Boolean));
    app.addHook('onRequest', async (request, reply) => {
        // Skip auth for health endpoint
        if (request.url === '/health' || request.url.startsWith('/health'))
            return;
        const apiKey = request.headers['x-api-key'] ??
            request.headers['authorization']?.replace('Bearer ', '');
        if (!apiKey) {
            return reply.code(401).send({ error: 'Missing API key. Provide X-Api-Key header.' });
        }
        // Dev: any key works; Prod: key must be in VALID_API_KEYS
        if (!isDev && validKeys.size > 0 && !validKeys.has(apiKey)) {
            return reply.code(401).send({ error: 'Invalid API key.' });
        }
    });
}
exports.default = (0, fastify_plugin_1.default)(apiKeyAuthPlugin, { name: 'api-key-auth' });
//# sourceMappingURL=api-key-auth.js.map
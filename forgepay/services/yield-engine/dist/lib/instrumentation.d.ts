/**
 * Fastify instrumentation plugin for HTTP metrics.
 * Tracks request duration and counts by method, route, and status code.
 * Normalizes routes by replacing UUIDs with {uuid} and numeric IDs with {id}.
 */
import type { FastifyInstance } from 'fastify';
interface InstrumentationOptions {
    normalizer?: (path: string) => string;
}
export declare function instrumentationPlugin(fastify: FastifyInstance, options?: InstrumentationOptions): Promise<void>;
declare module 'fastify' {
    interface FastifyRequest {
        startTime?: number;
    }
}
export default instrumentationPlugin;
//# sourceMappingURL=instrumentation.d.ts.map
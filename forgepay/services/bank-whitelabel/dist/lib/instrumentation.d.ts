import type { FastifyPluginAsync } from 'fastify';
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
declare const _default: FastifyPluginAsync;
export default _default;
//# sourceMappingURL=instrumentation.d.ts.map
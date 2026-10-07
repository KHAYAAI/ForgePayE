/**
 * Bank Admin Authentication
 *
 * Provides JWT-based auth separate from ForgePay merchant auth.
 * Tokens carry { adminId, bankId, role } so every downstream handler
 * can enforce tenant isolation without an extra DB lookup.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
/** Passwords set through the API in production. (Login keeps its looser check so existing short passwords can still sign in.) */
export declare const MIN_PRODUCTION_PASSWORD = 12;
export declare function registerAuthRoutes(app: FastifyInstance): Promise<void>;
export declare function registerBootstrapRoute(app: FastifyInstance): Promise<void>;
export declare function extractBankId(request: FastifyRequest): string;
export declare function extractAdminId(request: FastifyRequest): string;
export declare function extractRole(request: FastifyRequest): string;
export declare function extractIp(request: FastifyRequest): string;
export declare function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
//# sourceMappingURL=auth.d.ts.map
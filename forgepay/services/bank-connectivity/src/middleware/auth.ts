/**
 * JWT authentication middleware for the bank-connectivity service.
 *
 * Every protected route calls `verifyJwt` as a preHandler hook.
 * The hook reads the Bearer token from the Authorization header,
 * verifies it against JWT_SECRET, and decorates the request with the
 * decoded payload so route handlers can access req.jwtPayload.merchantId.
 *
 * On failure the hook replies immediately with 401 — the route handler
 * is never invoked.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload } from '../types';

// Extend FastifyRequest so TypeScript knows about our decoration.
declare module 'fastify' {
  interface FastifyRequest {
    jwtPayload: JwtPayload;
  }
}

/**
 * Prehandler that validates the Bearer JWT and attaches the decoded
 * payload to `req.jwtPayload`.  Register as:
 *
 *   app.addHook('preHandler', verifyJwt)
 *
 * or per-route via the `preHandler` option.
 */
export async function verifyJwt(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({
      statusCode: 401,
      error:   'Unauthorized',
      message: 'Missing or malformed Authorization header',
    });
  }

  const token = authHeader.slice(7);

  try {
    // @fastify/jwt decorates the Fastify instance with `fastify.jwt`.
    // We access it via `req.server` which holds a reference to the app.
    const payload = (req.server as import('fastify').FastifyInstance & {
      jwt: { verify: (token: string) => JwtPayload }
    }).jwt.verify(token) as JwtPayload;

    req.jwtPayload = payload;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid token';
    return reply.code(401).send({
      statusCode: 401,
      error:   'Unauthorized',
      message,
    });
  }
}

/**
 * Fastify module augmentation.
 *
 * routes/internal.ts marks internal-only routes with
 * `{ config: { skipAuth: true } }` — this field doesn't exist on the plain
 * `fastify` types, so the preHandler that reads it fails to compile without
 * this declaration even though the value is genuinely set at runtime.
 */

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Marks a route as internal-only, bypassing the standard auth preHandler. */
    skipAuth?: boolean;
  }
}

export {};

/**
 * Fastify module augmentation.
 *
 * routes/webhooks.ts marks its Circle webhook route with
 * `{ config: { rawBody: true } }` and reads `req.rawBody` — neither field
 * exists on the plain `fastify` types, so without this every consumer fails
 * to compile even though the values are genuinely populated at runtime by
 * the content-type parser in index.ts.
 */

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }

  interface FastifyContextConfig {
    /** Marks a route as needing the raw request body (see rawBody above). */
    rawBody?: boolean;
  }
}

export {};

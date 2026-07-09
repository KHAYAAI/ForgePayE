/**
 * Fastify module augmentation.
 *
 * Declares the shapes that routes/middleware across this service assume but
 * that plain `fastify` types don't know about — without this, every
 * `app.decorate(...)` consumer and every `request.user`/`request.rawBody`
 * read fails to compile (`Property 'db' does not exist...`, etc.) even
 * though the values are genuinely present at runtime.
 */

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
    redis: Redis;
  }

  interface FastifyRequest {
    /**
     * Populated by the `application/json` content-type parser in index.ts
     * with the exact bytes received, before JSON parsing — required for
     * HMAC signature verification over the raw payload.
     */
    rawBody?: Buffer;

    /**
     * Decoded auth principal. Not yet populated by any registered plugin —
     * the routes/middleware that read it (bundle.ts, csm.ts, customer.ts,
     * require-product.ts) are not currently mounted in index.ts. Declared
     * here so those modules type-check; wiring a real JWT-verification
     * preHandler is tracked separately before any of them are registered.
     */
    user?: {
      customerId?: string;
      tenantId?: string;
    };
  }

  interface FastifyContextConfig {
    /** Marks a route as needing the raw request body (see rawBody above). */
    rawBody?: boolean;
  }
}

export {};

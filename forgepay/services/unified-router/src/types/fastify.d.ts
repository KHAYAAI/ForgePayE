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
     * Decoded auth principal, populated by the `onRequest` hook in auth.ts.
     *
     * Both fields are undefined for the operator key, which is not scoped to a
     * single customer or tenant — handlers that act on one customer must read
     * the id from the route and authorise it via `customerAccessError()` rather
     * than assuming `customerId` is present.
     */
    user?: {
      customerId?: string;
      tenantId?: string;
    };

    /**
     * Full principal, including which kind of key authenticated. Prefer this in
     * new code; `user` exists because bundle.ts, csm.ts and customer.ts were
     * written against that shape before any authentication existed.
     */
    auth?: import('../auth.js').AuthContext;
  }

  interface FastifyContextConfig {
    /** Marks a route as needing the raw request body (see rawBody above). */
    rawBody?: boolean;
  }
}

export {};

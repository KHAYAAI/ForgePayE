/**
 * Redis-backed rate limiting.
 * ────────────────────────────────────────────────────────────────────────
 * `@fastify/rate-limit` defaults to an in-memory counter, which is real and
 * enforced but per-process: with more than one replica the effective global
 * limit scales with replica count instead of staying fixed, and every
 * counter resets on a rolling deploy — a burst that should have been
 * throttled gets a fresh budget on each pod. Fine at single-replica launch
 * scale; not fine once this service actually autoscales.
 *
 * Same opt-in shape as db.ts's persistence: REDIS_URL unset means the
 * in-memory store is used exactly as before (offline/demo/single-replica
 * behavior preserved). Set it and every replica shares one counter.
 */

import Redis from 'ioredis';

export function isRedisEnabled(): boolean {
  return !!process.env['REDIS_URL'];
}

let client: Redis | undefined;

/** Lazily creates the shared client. Call only when isRedisEnabled() is true. */
export function getRedisClient(): Redis {
  if (client) return client;

  client = new Redis(process.env['REDIS_URL']!, {
    maxRetriesPerRequest: 3,
    enableReadyCheck:     true,
    lazyConnect:          false,
  });

  client.on('error', (err) => {
    console.error('[credit-bureau] Redis error — rate limiting degrades to fail-open per-request behavior until reconnected', err);
  });

  return client;
}

/** Test helper — clears the memoised client so a fresh one is built next time. */
export function __resetRedisClient(): void {
  client = undefined;
}

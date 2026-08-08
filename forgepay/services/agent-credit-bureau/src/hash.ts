/**
 * Key hashing, kept in its own dependency-free module.
 *
 * `auth.ts` needs the contributor map from `store.ts`, and `store.ts` needs to
 * hash the seeded furnisher keys. Putting `hashApiKey` in `auth.ts` created an
 * import cycle: `store` → `auth` → `store`. Under tsx that happened to resolve
 * by load order, but under vitest the seed ran before `auth` had initialised
 * and `hashApiKey` was undefined at call time.
 *
 * This module imports nothing from the service, so it can sit underneath both.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** sha256 hex digest of an API key. Only digests are ever stored. */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Length-safe, constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

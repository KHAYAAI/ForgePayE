/**
 * API-key hashing, kept in its own dependency-free module (same split used by
 * agent-credit-bureau/src/hash.ts) so `store.ts` can hash seeded/issued keys
 * without creating an import cycle with `auth.ts`.
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

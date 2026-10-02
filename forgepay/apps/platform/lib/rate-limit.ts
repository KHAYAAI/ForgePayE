/**
 * A small fixed-window attempt limiter for credential endpoints (login, MFA). In-memory, so it is per
 * process: with several console replicas an attacker gets the limit once per replica. That is still a large
 * improvement over none; a shared store (Redis) is the next step for a multi-replica deployment.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface LimitResult { allowed: boolean; retryAfterSec: number }

export function hit(key: string, max: number, windowMs: number, now = Date.now()): LimitResult {
  if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  b.count++;
  return b.count > max ? { allowed: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) } : { allowed: true, retryAfterSec: 0 };
}

export function reset(key: string): void { buckets.delete(key); }
export function _clearAll(): void { buckets.clear(); }

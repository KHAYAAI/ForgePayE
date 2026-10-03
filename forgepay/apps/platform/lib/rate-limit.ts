/**
 * Fixed-window attempt limiter for credential endpoints (login, MFA), shared across replicas.
 *
 * With REDIS_URL set, counters live in Redis (one atomic INCR + PEXPIRE per attempt), so every console replica
 * enforces one limit and a rolling deploy does not reset it. Without it, or if Redis is unreachable, counters are
 * per process: the limiter degrades to a weaker one rather than locking everybody out or switching off, and
 * says so in the log. A deployment with more than one replica should set REDIS_URL.
 */
import { createClient } from 'redis';

export interface LimitResult { allowed: boolean; retryAfterSec: number }

const buckets = new Map<string, { count: number; resetAt: number }>();

function hitMemory(key: string, max: number, windowMs: number, now: number): LimitResult {
  if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  b.count++;
  return b.count > max ? { allowed: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) } : { allowed: true, retryAfterSec: 0 };
}

// Atomic: count the attempt, start the window on the first one, report the time left.
const SCRIPT = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}`;

type Client = ReturnType<typeof createClient>;
let client: Client | null = null;
let connecting: Promise<Client | null> | null = null;
let warned = false;

async function redis(): Promise<Client | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (client?.isReady) return client;
  connecting ??= (async () => {
    try {
      const c = createClient({ url, socket: { connectTimeout: 1500, reconnectStrategy: (n) => Math.min(n * 200, 3000) } });
      c.on('error', () => undefined); // surfaced through the fallback below, not as an unhandled event
      // With a reconnect strategy connect() never gives up by itself: bound the first attempt.
      await Promise.race([c.connect(), new Promise((_, rej) => setTimeout(() => rej(new Error('redis connect timeout')), 2000))]);
      client = c;
      return c;
    } catch {
      return null;
    } finally {
      connecting = null; // the next attempt retries; until it succeeds the per-process fallback applies
    }
  })();
  return connecting;
}

export async function hit(key: string, max: number, windowMs: number, now = Date.now()): Promise<LimitResult> {
  const r = await redis();
  if (r) {
    try {
      const [count, ttl] = (await r.eval(SCRIPT, { keys: ['rl:' + key], arguments: [String(windowMs)] })) as [number, number];
      return count > max ? { allowed: false, retryAfterSec: Math.max(1, Math.ceil(ttl / 1000)) } : { allowed: true, retryAfterSec: 0 };
    } catch { /* fall through to memory */ }
  }
  if (process.env.REDIS_URL && !warned) {
    warned = true;
    console.error('[rate-limit] REDIS_URL is set but Redis is unreachable: login throttling is per-process until it returns');
  }
  return hitMemory(key, max, windowMs, now);
}

export async function reset(key: string): Promise<void> {
  buckets.delete(key);
  const r = await redis();
  if (r) await r.del('rl:' + key).catch(() => undefined);
}

export function _clearAll(): void { buckets.clear(); }
export async function _closeForTests(): Promise<void> { const c = client; client = null; if (c) await c.quit().catch(() => undefined); }

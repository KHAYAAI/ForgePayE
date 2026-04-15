/**
 * Event deduplication using Redis.
 * We use a 7-day TTL — long enough to catch retries, short enough to avoid unbounded growth.
 */

const DEDUP_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const DEDUP_KEY_PREFIX  = 'fp:dedup:event:';

interface RedisClient {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, expiryMode: string, time: number) => Promise<unknown>;
}

/**
 * Returns true if the event has already been processed (duplicate).
 * Sets the key with TTL if it's a new event.
 */
export async function deduplicateEvent(
  redis: RedisClient,
  sourceEventId: string,
): Promise<boolean> {
  const key = `${DEDUP_KEY_PREFIX}${sourceEventId}`;
  const existing = await redis.get(key);
  if (existing) return true;

  await redis.set(key, '1', 'EX', DEDUP_TTL_SECONDS);
  return false;
}

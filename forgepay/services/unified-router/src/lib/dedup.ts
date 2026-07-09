/**
 * Event deduplication using Redis.
 *
 * NOTE: Why 7 days?
 *   Payment processors (Hyperswitch, Kill Bill) guarantee at-least-once delivery —
 *   they will retry a webhook until they receive HTTP 2xx. Retries can occur up to
 *   72 hours after the original event. 7 days gives a comfortable buffer beyond
 *   the longest retry window of any upstream service we integrate with.
 *
 * NOTE: Key schema — fp:dedup:event:{sourceEventId}
 *   sourceEventId comes from the upstream vendor's own event ID (e.g. Hyperswitch's
 *   event_id field). This ensures we deduplicate against the vendor's idempotency
 *   unit, not our own generated IDs.
 *
 * NOTE: The Postgres INSERT (ON CONFLICT DO NOTHING) in routes/webhooks.ts is a
 *   second idempotency layer that catches duplicates if Redis evicts a key early
 *   (LRU pressure). The DB unique index on source_event_id is the hard guarantee;
 *   Redis is the fast path that avoids hitting the DB for retries.
 */

const DEDUP_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const DEDUP_KEY_PREFIX  = 'fp:dedup:event:';

interface RedisClient {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, expiryMode: 'EX', time: number) => Promise<unknown>;
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

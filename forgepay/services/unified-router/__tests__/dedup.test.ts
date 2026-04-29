import { describe, it, expect, vi } from 'vitest';
import { deduplicateEvent } from '../src/lib/dedup.js';

function makeRedis(store: Map<string, string> = new Map()) {
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, _mode: string, _ttl: number) => {
      store.set(key, value);
      return 'OK';
    }),
  };
}

describe('deduplicateEvent', () => {
  it('returns false for a new event and stores the key', async () => {
    const redis = makeRedis();
    const isDup = await deduplicateEvent(redis, 'evt_new_001');
    expect(isDup).toBe(false);
    expect(redis.set).toHaveBeenCalledWith(
      'fp:dedup:event:evt_new_001',
      '1',
      'EX',
      expect.any(Number),
    );
  });

  it('returns true for a duplicate event (key already exists)', async () => {
    const store = new Map([['fp:dedup:event:evt_dup_001', '1']]);
    const redis = makeRedis(store);
    const isDup = await deduplicateEvent(redis, 'evt_dup_001');
    expect(isDup).toBe(true);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('returns false for a different event ID even if another is cached', async () => {
    const store = new Map([['fp:dedup:event:evt_other', '1']]);
    const redis = makeRedis(store);
    const isDup = await deduplicateEvent(redis, 'evt_brand_new');
    expect(isDup).toBe(false);
  });

  it('sequential calls: first false, second true', async () => {
    const redis = makeRedis();
    const first  = await deduplicateEvent(redis, 'evt_seq_001');
    const second = await deduplicateEvent(redis, 'evt_seq_001');
    expect(first).toBe(false);
    expect(second).toBe(true);
  });

  it('uses a 7-day TTL', async () => {
    const redis = makeRedis();
    await deduplicateEvent(redis, 'evt_ttl_check');
    const [, , , ttl] = redis.set.mock.calls[0];
    expect(ttl).toBe(60 * 60 * 24 * 7);
  });
});

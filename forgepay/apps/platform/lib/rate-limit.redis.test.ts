/**
 * The limiter against a REAL Redis, with two independent "replicas" (separate module instances and clients)
 * sharing one counter. Runs only when REDIS_TEST_URL is set (CI starts a Redis service for it).
 */
import { describe, it, expect, vi, afterAll } from 'vitest';

const url = process.env.REDIS_TEST_URL;

describe.skipIf(!url)('rate limit shared across replicas (real Redis)', () => {
  async function replica() {
    vi.resetModules();
    process.env.REDIS_URL = url;
    return import('./rate-limit');
  }
  const mods: Array<{ _closeForTests: () => Promise<void> }> = [];
  afterAll(async () => { for (const m of mods) await m._closeForTests(); });

  it('attempts on replica A count against replica B', async () => {
    const key = `test:${Date.now()}`;
    const a = await replica(); mods.push(a);
    const b = await replica(); mods.push(b);
    expect((await a.hit(key, 3, 5000)).allowed).toBe(true);
    expect((await b.hit(key, 3, 5000)).allowed).toBe(true);
    expect((await a.hit(key, 3, 5000)).allowed).toBe(true);
    const fourth = await b.hit(key, 3, 5000);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSec).toBeGreaterThan(0);
  });

  it('the window expires on its own', async () => {
    const key = `test:exp:${Date.now()}`;
    const a = await replica(); mods.push(a);
    await a.hit(key, 1, 300); expect((await a.hit(key, 1, 300)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 450));
    expect((await a.hit(key, 1, 300)).allowed).toBe(true);
  });

  it('concurrent attempts from many replicas are counted exactly (atomic)', async () => {
    const key = `test:atomic:${Date.now()}`;
    const reps = await Promise.all([replica(), replica(), replica()]); mods.push(...reps);
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => reps[i % 3]!.hit(key, 10, 5000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });
});

describe('without Redis', () => {
  it('falls back to a per-process limit and still limits', async () => {
    vi.resetModules();
    process.env.REDIS_URL = 'redis://127.0.0.1:1'; // nothing there
    const m = await import('./rate-limit');
    expect((await m.hit('x', 1, 5000)).allowed).toBe(true);
    expect((await m.hit('x', 1, 5000)).allowed).toBe(false);
    delete process.env.REDIS_URL;
  });
});

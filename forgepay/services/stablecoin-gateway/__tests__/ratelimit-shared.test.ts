import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('../src/lib/db.js', () => ({ getDb: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }) }));
const url = process.env['REDIS_TEST_URL'];
const ENV = { ...process.env };

beforeAll(() => {
  Object.assign(process.env, {
    POSTGRES_PASSWORD: 't', INTERNAL_WEBHOOK_SECRET: 't', CORS_ALLOWED_ORIGINS: 'https://a.test', NODE_ENV: 'test',
    VALID_API_KEYS: 'test-key-that-is-long-enough-to-pass-strength-checks', RATE_LIMIT_PER_MIN: '20', REDIS_URL: url,
  });
});
afterAll(() => { process.env = { ...ENV }; });

// Two gateway instances ("replicas") in one process sharing one Redis: one client's budget is shared between them.
describe.skipIf(!url)('gateway rate limit shared across replicas (real Redis)', () => {
  it('requests spread over two replicas hit one limit', async () => {
    const { buildApp } = await import('../src/index.js');
    const [a, b] = [await buildApp(), await buildApp()];
    await Promise.all([a.ready(), b.ready()]);
    await new Promise((r) => setTimeout(r, 800)); // let both Redis connections come up (until then the limiter fails open by design)
    let limited = 0;
    for (let i = 0; i < 30; i++) {
      const r = await (i % 2 ? a : b).inject({ method: 'GET', url: '/healthz', remoteAddress: '10.20.30.40' });
      if (r.statusCode === 429) limited++;
    }
    await Promise.all([a.close(), b.close()]);
    // With per-process counters each replica would have seen 15 requests and refused none (limit 20).
    expect(limited).toBeGreaterThan(0);
  });
});

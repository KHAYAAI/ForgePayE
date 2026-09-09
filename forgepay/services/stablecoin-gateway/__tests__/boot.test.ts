/**
 * The gateway must actually assemble.
 *
 * This exists because it didn't. @fastify/rate-limit@9 and @fastify/cors@9 are
 * Fastify 4 plugins and this service runs Fastify 5; both threw
 * FST_ERR_PLUGIN_VERSION_MISMATCH the moment buildApp() registered them, so the
 * service could not start at all. Every test in this suite passed throughout,
 * because not one of them built the real app — they registered hand-rolled
 * routes onto a bare Fastify instance instead.
 *
 * A green suite over a service that cannot boot is the failure mode worth
 * guarding against, so this test does the one thing the others skipped: call
 * the real buildApp() and route a request through the fully assembled stack.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../src/lib/db.js', () => ({
  getDb: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}));

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  process.env['POSTGRES_PASSWORD'] = 'test-password';
  process.env['INTERNAL_WEBHOOK_SECRET'] = 'test-webhook-secret';
  process.env['CORS_ALLOWED_ORIGINS'] = 'https://app.forgepay.test';
  process.env['VALID_API_KEYS'] = 'test-key-that-is-long-enough-to-pass-strength-checks';
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('buildApp', () => {
  it('registers every plugin and route without a version mismatch', async () => {
    const { buildApp } = await import('../src/index.js');
    const app = await buildApp();
    await app.ready();
    await app.close();
  });

  it('serves /healthz through the fully assembled stack', async () => {
    const { buildApp } = await import('../src/index.js');
    const app = await buildApp();
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'stablecoin-gateway' });

    await app.close();
  });

  it('mounts the payout routes', async () => {
    const { buildApp } = await import('../src/index.js');
    const app = await buildApp();
    await app.ready();

    // Authenticated separately; all that matters here is that the route exists
    // rather than 404ing, i.e. that buildPayoutRoutes was registered.
    const res = await app.inject({ method: 'GET', url: '/payouts/config' });
    expect(res.statusCode).not.toBe(404);

    await app.close();
  });
});

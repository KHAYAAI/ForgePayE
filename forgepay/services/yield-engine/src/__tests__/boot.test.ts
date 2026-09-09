/**
 * The service must actually assemble.
 *
 * Three deployment faults reached production across this platform without one
 * test noticing, because no suite ever built the real app — they exercised
 * helpers, or registered hand-rolled routes onto a bare Fastify instance. The
 * fault that mattered lived in plugin registration, the first thing buildApp()
 * does and the last thing anything tested.
 *
 * This calls the real buildApp() and routes a request through the fully
 * assembled stack. It is deliberately shallow: the point is that the app comes
 * up at all, not what any particular route returns.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../index';

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  process.env['VALID_API_KEYS'] = 'a-test-api-key-long-enough-to-pass-strength-checks';
  process.env['CORS_ALLOWED_ORIGINS'] = 'https://app.forgepay.test';
  process.env['CORS_ORIGIN'] = 'https://app.forgepay.test';
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('buildApp', () => {
  it('registers every plugin and route without a version mismatch', async () => {
    // FST_ERR_PLUGIN_VERSION_MISMATCH — a Fastify 4 plugin on a Fastify 5
    // server — surfaces here and nowhere else.
    const app = await buildApp();
    await app.ready();
    await app.close();
  });

  it('serves a request through the fully assembled stack', async () => {
    const app = await buildApp();
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);

    await app.close();
  });
});

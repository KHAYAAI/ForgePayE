/**
 * checkSanctions() — real compliance-monitor integration.
 *
 * No test existed for this function before; the only coverage was
 * evaluatePolicies() exercising it indirectly with COMPLIANCE_MONITOR_URL
 * unset (the dev-skip path). This covers the HTTP integration itself: the
 * route it calls, the auth header it sends, and how it maps
 * compliance-monitor's real ScreeningResult shape to clear/hit/error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSanctions } from '../src/policy';

function mockFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn(async (_url: string, _opts: RequestInit) => ({ ok, status, json: async () => body }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function mockFetchThrow(err: Error = new Error('connect ECONNREFUSED')): void {
  vi.stubGlobal('fetch', vi.fn(async () => { throw err; }));
}

function screeningResult(overrides: Record<string, unknown> = {}) {
  return {
    entity_id: '0xabc',
    entity_type: 'address',
    name: '0xabc',
    screened_at: new Date().toISOString(),
    result: 'clear',
    matches: [],
    risk_score: 0,
    recommended_action: 'allow',
    ...overrides,
  };
}

const ORIGINAL_ENV = { ...process.env };

describe('checkSanctions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete process.env.COMPLIANCE_MONITOR_URL;
    delete process.env.COMPLIANCE_MONITOR_API_KEY;
    process.env.NODE_ENV = 'test';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('passes clear with a warning when COMPLIANCE_MONITOR_URL is unset outside production', async () => {
    const fetchFn = mockFetch({});
    const result = await checkSanctions('0xabc');
    expect(result).toBe('clear');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails closed when COMPLIANCE_MONITOR_URL is unset in production', async () => {
    process.env.NODE_ENV = 'production';
    const result = await checkSanctions('0xabc');
    expect(result).toBe('error');
  });

  it('POSTs to the real /api/v1/screening/address route with the auth header', async () => {
    process.env.COMPLIANCE_MONITOR_URL = 'http://compliance-monitor:8004';
    process.env.COMPLIANCE_MONITOR_API_KEY = 'test-key';
    const fetchFn = mockFetch(screeningResult());

    await checkSanctions('0xabc');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://compliance-monitor:8004/api/v1/screening/address');
    expect(opts.method).toBe('POST');
    expect(opts.headers).toMatchObject({
      'content-type': 'application/json',
      'X-Compliance-API-Key': 'test-key',
    });
    expect(JSON.parse(opts.body as string)).toEqual({ address: '0xabc' });
  });

  it('omits the auth header when no API key is configured', async () => {
    process.env.COMPLIANCE_MONITOR_URL = 'http://compliance-monitor:8004';
    const fetchFn = mockFetch(screeningResult());

    await checkSanctions('0xabc');

    const [, opts] = fetchFn.mock.calls[0]!;
    expect(opts.headers).not.toHaveProperty('X-Compliance-API-Key');
  });

  it('maps a clear/allow result to clear', async () => {
    process.env.COMPLIANCE_MONITOR_URL = 'http://compliance-monitor:8004';
    mockFetch(screeningResult({ result: 'clear', recommended_action: 'allow' }));
    expect(await checkSanctions('0xabc')).toBe('clear');
  });

  it('maps a confirmed_match/block result to hit', async () => {
    process.env.COMPLIANCE_MONITOR_URL = 'http://compliance-monitor:8004';
    mockFetch(screeningResult({ result: 'confirmed_match', recommended_action: 'block' }));
    expect(await checkSanctions('0xabc')).toBe('hit');
  });

  it('maps a potential_match/review result to hit (not clear)', async () => {
    process.env.COMPLIANCE_MONITOR_URL = 'http://compliance-monitor:8004';
    mockFetch(screeningResult({ result: 'potential_match', recommended_action: 'review' }));
    expect(await checkSanctions('0xabc')).toBe('hit');
  });

  it('treats a non-2xx response as error', async () => {
    process.env.COMPLIANCE_MONITOR_URL = 'http://compliance-monitor:8004';
    mockFetch({}, false, 503);
    expect(await checkSanctions('0xabc')).toBe('error');
  });

  it('treats a thrown fetch error as error', async () => {
    process.env.COMPLIANCE_MONITOR_URL = 'http://compliance-monitor:8004';
    mockFetchThrow();
    expect(await checkSanctions('0xabc')).toBe('error');
  });
});

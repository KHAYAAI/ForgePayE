import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screenAddress, screenEntity, type ScreeningResult } from './sanctions';

function mockFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn(async (_url: string, _opts: RequestInit) => ({ ok, status, json: async () => body }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function mockFetchThrow(err: Error = new Error('connect ECONNREFUSED')): void {
  vi.stubGlobal('fetch', vi.fn(async () => { throw err; }));
}

function screeningResult(overrides: Partial<ScreeningResult> = {}): ScreeningResult {
  return {
    entity_id: 'agent_x',
    entity_type: 'business',
    name: 'Agent X',
    screened_at: new Date().toISOString(),
    result: 'clear',
    matches: [],
    risk_score: 0,
    recommended_action: 'allow',
    ...overrides,
  };
}

const ORIGINAL_ENV = { ...process.env };

describe('sanctions.ts — compliance-monitor integration', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete process.env['COMPLIANCE_MONITOR_URL'];
    delete process.env['COMPLIANCE_MONITOR_API_KEY'];
    process.env['NODE_ENV'] = 'test';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  describe('unconfigured', () => {
    it('passes clear with a warning in development when COMPLIANCE_MONITOR_URL is unset', async () => {
      const fetchFn = mockFetch({});
      const out = await screenAddress('0xabc');
      expect(out).toEqual({ checked: false, clear: true, reason: 'not_configured_dev' });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('fails closed in production when COMPLIANCE_MONITOR_URL is unset', async () => {
      process.env['NODE_ENV'] = 'production';
      const out = await screenEntity('agent_x', 'business', 'Agent X Inc');
      expect(out).toEqual({ checked: false, clear: false, reason: 'not_configured_prod' });
    });
  });

  describe('screenAddress', () => {
    beforeEach(() => {
      process.env['COMPLIANCE_MONITOR_URL'] = 'http://compliance-monitor:8004';
      process.env['COMPLIANCE_MONITOR_API_KEY'] = 'test-key';
    });

    it('POSTs to the real /api/v1/screening/address route with auth header', async () => {
      const fetchFn = mockFetch(screeningResult());
      await screenAddress('0xabc', 'ETH');

      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchFn.mock.calls[0]!;
      expect(url).toBe('http://compliance-monitor:8004/api/v1/screening/address');
      expect(opts.method).toBe('POST');
      expect(opts.headers).toMatchObject({
        'content-type': 'application/json',
        'X-Compliance-API-Key': 'test-key',
      });
      expect(JSON.parse(opts.body as string)).toEqual({ address: '0xabc', chain: 'ETH' });
    });

    it('reports clear only for an explicit allow recommendation', async () => {
      mockFetch(screeningResult({ result: 'clear', recommended_action: 'allow' }));
      const out = await screenAddress('0xabc');
      expect(out).toMatchObject({ checked: true, clear: true });
    });

    it('reports not clear on potential_match/review', async () => {
      mockFetch(screeningResult({ result: 'potential_match', recommended_action: 'review' }));
      const out = await screenAddress('0xabc');
      expect(out).toMatchObject({ checked: true, clear: false });
    });

    it('reports not clear on confirmed_match/block', async () => {
      mockFetch(screeningResult({ result: 'confirmed_match', recommended_action: 'block' }));
      const out = await screenAddress('0xabc');
      expect(out).toMatchObject({ checked: true, clear: false });
    });

    it('reports not clear when result is error even if recommended_action is allow', async () => {
      mockFetch(screeningResult({ result: 'error', recommended_action: 'allow' }));
      const out = await screenAddress('0xabc');
      expect(out).toMatchObject({ checked: true, clear: false });
    });

    it('treats a non-2xx response as call_failed', async () => {
      mockFetch({}, false, 503);
      const out = await screenAddress('0xabc');
      expect(out).toEqual({ checked: false, clear: false, reason: 'call_failed' });
    });

    it('treats a thrown fetch error as call_failed', async () => {
      mockFetchThrow();
      const out = await screenAddress('0xabc');
      expect(out).toEqual({ checked: false, clear: false, reason: 'call_failed' });
    });
  });

  describe('screenEntity', () => {
    beforeEach(() => {
      process.env['COMPLIANCE_MONITOR_URL'] = 'http://compliance-monitor:8004/';
      process.env['COMPLIANCE_MONITOR_API_KEY'] = 'test-key';
    });

    it('POSTs to the real /api/v1/screening/entity route with the expected payload', async () => {
      const fetchFn = mockFetch(screeningResult());
      await screenEntity('agent_x', 'person', 'Jane Doe');

      const [url, opts] = fetchFn.mock.calls[0]!;
      // Trailing slash on the configured base URL must not produce a double slash.
      expect(url).toBe('http://compliance-monitor:8004/api/v1/screening/entity');
      expect(JSON.parse(opts.body as string)).toEqual({
        entity_id: 'agent_x',
        entity_type: 'person',
        name: 'Jane Doe',
      });
    });

    it('omits the auth header when no API key is configured', async () => {
      delete process.env['COMPLIANCE_MONITOR_API_KEY'];
      const fetchFn = mockFetch(screeningResult());
      await screenEntity('agent_x', 'business', 'Agent X Inc');

      const [, opts] = fetchFn.mock.calls[0]!;
      expect(opts.headers).not.toHaveProperty('X-Compliance-API-Key');
    });
  });
});

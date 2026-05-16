import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assessAgent } from '../assessor';

function mockFetch(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })));
}

function mockFetchThrow(err: Error = new Error('connect ECONNREFUSED')): void {
  vi.stubGlobal('fetch', vi.fn(async () => { throw err; }));
}

describe('assessAgent', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns unavailable when reputation service throws', async () => {
    mockFetchThrow();
    const out = await assessAgent('agent_x');
    expect(out.approved).toBe(false);
    expect(out.reasons).toContain('reputation_service_unavailable');
    expect(out.recommendedLimitUsd).toBe(0);
  });

  it('returns unavailable when reputation service returns non-2xx', async () => {
    mockFetch({}, false, 503);
    const out = await assessAgent('agent_x');
    expect(out.approved).toBe(false);
    expect(out.reasons).toContain('reputation_service_unavailable');
  });

  it('approves tier prime ($100k @ 60d @ 6%) for high reputation + extensive history', async () => {
    mockFetch({ reputationScore: 85, transactionCount: 250 });
    const out = await assessAgent('agent_prime');
    expect(out.approved).toBe(true);
    expect(out.recommendedLimitUsd).toBe(100_000);
    expect(out.recommendedTermsDays).toBe(60);
    expect(out.recommendedInterestRateBps).toBe(600);
    expect(out.reasons).toContain('tier_prime');
  });

  it('approves tier standard ($25k @ 30d @ 9%) for good reputation + medium history', async () => {
    mockFetch({ reputationScore: 65, transactionCount: 75 });
    const out = await assessAgent('agent_std');
    expect(out.approved).toBe(true);
    expect(out.recommendedLimitUsd).toBe(25_000);
    expect(out.recommendedTermsDays).toBe(30);
    expect(out.recommendedInterestRateBps).toBe(900);
    expect(out.reasons).toContain('tier_standard');
  });

  it('approves tier starter ($5k @ 30d @ 12%) for minimal qualifications', async () => {
    mockFetch({ reputationScore: 45, transactionCount: 15 });
    const out = await assessAgent('agent_start');
    expect(out.approved).toBe(true);
    expect(out.recommendedLimitUsd).toBe(5_000);
    expect(out.recommendedInterestRateBps).toBe(1200);
    expect(out.reasons).toContain('tier_starter');
  });

  it('declines with insufficient_reputation when score below 40', async () => {
    mockFetch({ reputationScore: 30, transactionCount: 200 });
    const out = await assessAgent('agent_low');
    expect(out.approved).toBe(false);
    expect(out.reasons).toContain('insufficient_reputation');
  });

  it('declines with insufficient_history when txns too low', async () => {
    mockFetch({ reputationScore: 90, transactionCount: 5 });
    const out = await assessAgent('agent_new');
    expect(out.approved).toBe(false);
    expect(out.reasons).toContain('insufficient_history');
  });

  it('accepts alternate field names (score / txCount)', async () => {
    mockFetch({ score: 85, txCount: 200 });
    const out = await assessAgent('agent_alt');
    expect(out.approved).toBe(true);
    expect(out.recommendedLimitUsd).toBe(100_000);
  });
});

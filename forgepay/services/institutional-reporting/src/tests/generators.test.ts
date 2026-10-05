import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateCashFlowReport } from '../generators/cash-flow';
import { generateNettingReport } from '../generators/netting';
import { generateTaxFilingPacket } from '../generators/tax-filing';
import { generateYieldIncomeReport } from '../generators/yield-income';
import { resolveApiKeys, keyAccepted } from '../auth';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Cash flow generator ───────────────────────────────────────────────────────

function makeTwoCallFetch(
  cashPositionJson: unknown,
  execLogJson: unknown,
  opts: { ok?: boolean; status?: number } = {},
) {
  const ok = opts.ok ?? true;
  const status = opts.status ?? 200;
  return vi.fn()
    .mockResolvedValueOnce({ ok, status, json: async () => cashPositionJson })
    .mockResolvedValueOnce({ ok, status, json: async () => execLogJson });
}

describe('generateCashFlowReport', () => {
  it('returns a report with correct period', async () => {
    vi.stubGlobal('fetch', makeTwoCallFetch(
      { data: { totalUsd: 5_000_000, deployedInYieldUsd: 500_000 } },
      { data: [] },
    ));

    const report = await generateCashFlowReport({
      enterpriseId: 'ent-1',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      treasuryBaseUrl: 'http://treasury',
    });

    expect(report.period.start).toBe('2026-01-01');
    expect(report.period.end).toBe('2026-01-31');
    expect(report.enterpriseId).toBe('ent-1');
    expect(report.endingBalanceUsd).toBe(5_000_000);
  });

  it('captures data_source_errors when upstream fails', async () => {
    vi.stubGlobal('fetch', makeTwoCallFetch({}, {}, { ok: false, status: 503 }));

    const report = await generateCashFlowReport({
      enterpriseId: 'ent-1',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      treasuryBaseUrl: 'http://treasury',
    });

    expect(report.data_source_errors).toBeDefined();
    expect(report.data_source_errors!.length).toBeGreaterThan(0);
    expect(report.data_source_errors![0]).toMatch(/503/);
  });

  it('captures data_source_errors on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const report = await generateCashFlowReport({
      enterpriseId: 'ent-1',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      treasuryBaseUrl: 'http://treasury',
    });

    expect(report.data_source_errors).toBeDefined();
    expect(report.data_source_errors![0]).toMatch(/ECONNREFUSED/);
  });

  it('does not invent operating flows or a beginning balance (they used to be $50K/$35K a day)', async () => {
    vi.stubGlobal('fetch', makeTwoCallFetch(
      { data: { totalUsd: 1_000_000, deployedInYieldUsd: 0 } },
      { data: [] },
    ));

    const report = await generateCashFlowReport({
      enterpriseId: 'ent-1',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-11',
      treasuryBaseUrl: 'http://treasury',
    });

    expect(report.operatingInflowsUsd).toBeNull();
    expect(report.operatingOutflowsUsd).toBeNull();
    expect(report.beginningBalanceUsd).toBeNull();
    expect(report.endingBalanceUsd).toBe(1_000_000);
    expect(report.complete).toBe(false);
    expect(report.notes.join(' ')).toMatch(/not available/);
  });

  it('counts only treasury activity inside the period, and sends treasury its API key', async () => {
    const fetchMock = makeTwoCallFetch(
      { data: { totalUsd: 0 } },
      { data: [
        { result: 'executed', actionType: 'send_intercompany', amountUsd: 100, timestamp: '2026-01-05T10:00:00Z' },
        { result: 'executed', actionType: 'send_intercompany', amountUsd: 999, timestamp: '2025-12-31T10:00:00Z' },
      ] },
    );
    vi.stubGlobal('fetch', fetchMock);
    const report = await generateCashFlowReport({
      enterpriseId: 'ent-1', periodStart: '2026-01-01', periodEnd: '2026-01-11',
      treasuryBaseUrl: 'http://treasury', treasuryApiKey: 'treasury-key',
    });
    expect(report.financingFlowsUsd).toBe(-100);
    const init = (fetchMock as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]![1];
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('treasury-key');
  });
});

// ── Netting report generator ──────────────────────────────────────────────────

describe('generateNettingReport', () => {
  it('maps netting pairs from upstream response', async () => {
    const mockData = {
      data: [
        { fromSubsidiary: 'HQ', toSubsidiary: 'EMEA', grossAmount: 1_000_000, netAmount: 200_000, feesSavedUsd: 50 },
      ],
      summary: {
        totalGrossUsd: 1_000_000,
        totalNetUsd: 200_000,
        totalFeesSavedUsd: 50,
        reductionPercent: 80,
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    }));

    const report = await generateNettingReport({
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
      treasuryBaseUrl: 'http://treasury',
    });

    expect(report.byPair).toHaveLength(1);
    expect(report.byPair[0]!.fromSubsidiary).toBe('HQ');
    expect(report.totalGrossFlowsUsd).toBe(1_000_000);
    expect(report.reductionPercent).toBe(80);
  });

  it('captures errors when netting upstream is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    const report = await generateNettingReport({
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
      treasuryBaseUrl: 'http://treasury',
    });

    expect(report.data_source_errors).toBeDefined();
    expect(report.data_source_errors![0]).toMatch(/timeout/);
    expect(report.byPair).toHaveLength(0);
  });
});

// ── Not-available reports ─────────────────────────────────────────────────────

describe('reports with no data source', () => {
  it('tax filing produces no lines (they were $1,000/day × a rate)', () => {
    const p = generateTaxFilingPacket('US', { start: '2026-01-01', end: '2026-03-31' });
    expect(p.available).toBe(false);
    expect(p.lines).toEqual([]);
  });

  it('yield income is unknown, not zero', async () => {
    const r = await generateYieldIncomeReport({ periodStart: '2026-01-01', periodEnd: '2026-03-31', yieldEngineBaseUrl: 'http://y' });
    expect(r.totalYieldUsd).toBeNull();
    expect(r.federalTaxEstimateUsd).toBeNull();
    expect(r.complete).toBe(false);
  });
});

describe('API keys', () => {
  it('production refuses to start without strong keys', () => {
    expect(() => resolveApiKeys({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/VALID_API_KEYS/);
    expect(() => resolveApiKeys({ NODE_ENV: 'production', VALID_API_KEYS: 'short' } as NodeJS.ProcessEnv)).toThrow(/at least/);
  });

  it('accepts only a configured key', () => {
    const keys = resolveApiKeys({ VALID_API_KEYS: 'k1-long-enough-key-for-tests-000000' } as NodeJS.ProcessEnv);
    expect(keyAccepted('k1-long-enough-key-for-tests-000000', keys)).toBe(true);
    expect(keyAccepted('nope', keys)).toBe(false);
    expect(keyAccepted(undefined, keys)).toBe(false);
  });
});

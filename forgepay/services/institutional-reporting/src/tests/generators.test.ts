import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateCashFlowReport } from '../generators/cash-flow';
import { generateNettingReport } from '../generators/netting';

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

  it('derives operating flows from period length', async () => {
    vi.stubGlobal('fetch', makeTwoCallFetch(
      { data: { totalUsd: 0, deployedInYieldUsd: 0 } },
      { data: [] },
    ));

    const report = await generateCashFlowReport({
      enterpriseId: 'ent-1',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-11', // 10 days
      treasuryBaseUrl: 'http://treasury',
    });

    // 10 days × $50k/day
    expect(report.operatingInflowsUsd).toBe(500_000);
    // 10 days × $35k/day
    expect(report.operatingOutflowsUsd).toBe(350_000);
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

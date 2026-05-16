import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createDraw, repayDraw, checkOverdueAndDefault, DrawError } from '../draws';
import { _resetStore, putCreditLine, getCreditLine, getDraw, listDefaults } from '../store';
import type { CreditLine } from '../types';

const MS_PER_DAY = 86_400_000;

const seedLine = (overrides: Partial<CreditLine> = {}): CreditLine => {
  const line: CreditLine = {
    id:              'cl_test',
    agentId:         'agent_a',
    limitUsd:        10_000,
    availableUsd:    10_000,
    usedUsd:         0,
    termsDays:       30,
    interestRateBps: 1200,    // 12% APR
    status:          'active',
    createdAt:       new Date().toISOString(),
    ...overrides,
  };
  putCreditLine(line);
  return line;
};

describe('draws', () => {
  beforeEach(() => {
    _resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a draw, debits the credit line, and computes interest', () => {
    seedLine();
    const draw = createDraw({ creditLineId: 'cl_test', amountUsd: 1_000, purpose: 'gpu_compute' });
    expect(draw.amountUsd).toBe(1_000);
    // 12% APR * 30/365 ≈ 0.00986 → totalOwed ≈ 1009.86
    expect(draw.totalOwedUsd).toBeGreaterThan(1_000);
    expect(draw.totalOwedUsd).toBeLessThan(1_015);
    expect(draw.status).toBe('outstanding');

    const line = getCreditLine('cl_test')!;
    expect(line.usedUsd).toBe(1_000);
    expect(line.availableUsd).toBe(9_000);
  });

  it('rejects a draw exceeding available credit', () => {
    seedLine({ limitUsd: 500, availableUsd: 500 });
    expect(() => createDraw({ creditLineId: 'cl_test', amountUsd: 1_000, purpose: 'x' }))
      .toThrow(DrawError);
  });

  it('rejects a draw against a suspended line', () => {
    seedLine({ status: 'suspended' });
    expect(() => createDraw({ creditLineId: 'cl_test', amountUsd: 100, purpose: 'x' }))
      .toThrow(/suspended/);
  });

  it('fully repays a draw and restores credit line availability', () => {
    seedLine();
    const draw   = createDraw({ creditLineId: 'cl_test', amountUsd: 1_000, purpose: 'p' });
    const result = repayDraw(draw.id, draw.totalOwedUsd);
    expect(result.fullyRepaid).toBe(true);
    expect(result.draw.status).toBe('repaid');
    expect(result.draw.repaidAt).toBeTruthy();
    const line = getCreditLine('cl_test')!;
    expect(line.availableUsd).toBe(10_000);
    expect(line.usedUsd).toBe(0);
  });

  it('handles partial repayments without closing the draw', () => {
    seedLine();
    const draw    = createDraw({ creditLineId: 'cl_test', amountUsd: 1_000, purpose: 'p' });
    const result1 = repayDraw(draw.id, 400);
    expect(result1.fullyRepaid).toBe(false);
    expect(result1.draw.status).toBe('outstanding');
    expect(result1.appliedUsd).toBe(400);
    expect(result1.remainingOwedUsd).toBeGreaterThan(0);

    const result2 = repayDraw(draw.id, 10_000);   // over-pay → caps at remaining
    expect(result2.fullyRepaid).toBe(true);
    expect(result2.draw.status).toBe('repaid');
  });

  it('rejects repayment on an already-repaid draw', () => {
    seedLine();
    const draw = createDraw({ creditLineId: 'cl_test', amountUsd: 100, purpose: 'p' });
    repayDraw(draw.id, draw.totalOwedUsd);
    expect(() => repayDraw(draw.id, 10)).toThrow(/already repaid/);
  });

  it('marks an outstanding draw as overdue once dueAt has passed', async () => {
    seedLine();
    const draw = createDraw({ creditLineId: 'cl_test', amountUsd: 500, purpose: 'p' });
    // Simulate "now" being 1 day past dueAt
    const futureNow = new Date(new Date(draw.dueAt).getTime() + 1 * MS_PER_DAY);
    const result = await checkOverdueAndDefault(futureNow);
    expect(result.overdue).toBe(1);
    expect(result.defaulted).toBe(0);
    expect(getDraw(draw.id)?.status).toBe('overdue');
  });

  it('defaults a draw after dueAt + 14 days and records the loss', async () => {
    // Silence the fire-and-forget penalty webhook
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));

    seedLine();
    const draw = createDraw({ creditLineId: 'cl_test', amountUsd: 800, purpose: 'p' });
    const futureNow = new Date(new Date(draw.dueAt).getTime() + 15 * MS_PER_DAY);
    const result = await checkOverdueAndDefault(futureNow);
    expect(result.defaulted).toBe(1);
    expect(result.defaultedDrawIds).toContain(draw.id);
    expect(getDraw(draw.id)?.status).toBe('defaulted');

    const records = listDefaults();
    expect(records).toHaveLength(1);
    expect(records[0]!.drawId).toBe(draw.id);
    expect(records[0]!.lossUsd).toBeGreaterThan(800);   // principal + interest

    vi.unstubAllGlobals();
  });

  it('uses vi.useFakeTimers to detect default after 14d grace period', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    vi.useFakeTimers();
    const baseDate = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(baseDate);

    seedLine({ termsDays: 30 });
    const draw = createDraw({ creditLineId: 'cl_test', amountUsd: 1_000, purpose: 'p' });

    // 30 days + 10 days = overdue (not yet defaulted)
    vi.setSystemTime(new Date(baseDate.getTime() + 40 * MS_PER_DAY));
    let result = await checkOverdueAndDefault();
    expect(result.overdue).toBe(1);
    expect(result.defaulted).toBe(0);

    // 30 days + 15 days = defaulted
    vi.setSystemTime(new Date(baseDate.getTime() + 45 * MS_PER_DAY));
    result = await checkOverdueAndDefault();
    expect(result.defaulted).toBe(1);
    expect(getDraw(draw.id)?.status).toBe('defaulted');

    vi.unstubAllGlobals();
  });

  it('does not double-default an already-defaulted draw on repeat sweeps', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    seedLine();
    const draw = createDraw({ creditLineId: 'cl_test', amountUsd: 200, purpose: 'p' });
    const futureNow = new Date(new Date(draw.dueAt).getTime() + 20 * MS_PER_DAY);

    const first  = await checkOverdueAndDefault(futureNow);
    const second = await checkOverdueAndDefault(futureNow);
    expect(first.defaulted).toBe(1);
    expect(second.defaulted).toBe(0);
    expect(listDefaults()).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

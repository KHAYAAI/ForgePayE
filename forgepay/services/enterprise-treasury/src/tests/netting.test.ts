import { describe, it, expect, beforeEach } from 'vitest';
import { addFlow, listFlows, calculateNetting, getNettingSummary, clearSettledFlows } from '../netting';
import type { NettingFlow } from '../types';

function makeFlow(overrides: Partial<NettingFlow>): NettingFlow {
  return {
    fromSubsidiary: 'HQ',
    toSubsidiary:   'EMEA',
    amount:         100_000,
    currency:       'USD',
    dueDate:        '2026-06-01',
    ...overrides,
  };
}

describe('netting engine', () => {
  beforeEach(() => {
    clearSettledFlows();
  });

  it('returns empty results with no flows', () => {
    expect(calculateNetting()).toEqual([]);
    expect(listFlows()).toEqual([]);
  });

  it('calculates net amount for bilateral flows', () => {
    addFlow(makeFlow({ fromSubsidiary: 'HQ',   toSubsidiary: 'EMEA', amount: 300_000 }));
    addFlow(makeFlow({ fromSubsidiary: 'EMEA', toSubsidiary: 'HQ',   amount: 100_000 }));

    const results = calculateNetting();
    expect(results).toHaveLength(1);
    expect(results[0]!.grossAmount).toBe(400_000);
    expect(results[0]!.netAmount).toBe(200_000);
    expect(results[0]!.fromSubsidiary).toBe('HQ');
    expect(results[0]!.toSubsidiary).toBe('EMEA');
  });

  it('returns zero netAmount for perfectly offsetting flows', () => {
    addFlow(makeFlow({ fromSubsidiary: 'HQ',   toSubsidiary: 'APAC', amount: 50_000 }));
    addFlow(makeFlow({ fromSubsidiary: 'APAC', toSubsidiary: 'HQ',   amount: 50_000 }));

    const results = calculateNetting();
    expect(results[0]!.netAmount).toBe(0);
  });

  it('calculates feesSavedUsd at $25 per avoided transaction', () => {
    addFlow(makeFlow({ fromSubsidiary: 'HQ',   toSubsidiary: 'EMEA', amount: 100_000 }));
    addFlow(makeFlow({ fromSubsidiary: 'HQ',   toSubsidiary: 'EMEA', amount: 200_000 }));
    addFlow(makeFlow({ fromSubsidiary: 'EMEA', toSubsidiary: 'HQ',   amount: 150_000 }));

    const results = calculateNetting();
    // 2 HQ→EMEA, 1 EMEA→HQ → min(2,1)=1 avoided, fee saved = $25
    expect(results[0]!.feesSavedUsd).toBe(25);
  });

  it('handles multiple subsidiary pairs independently', () => {
    addFlow(makeFlow({ fromSubsidiary: 'HQ',   toSubsidiary: 'EMEA', amount: 200_000 }));
    addFlow(makeFlow({ fromSubsidiary: 'HQ',   toSubsidiary: 'APAC', amount: 100_000 }));

    const results = calculateNetting();
    expect(results).toHaveLength(2);
  });

  it('sorts results by netAmount descending', () => {
    addFlow(makeFlow({ fromSubsidiary: 'HQ',   toSubsidiary: 'EMEA', amount: 50_000 }));
    addFlow(makeFlow({ fromSubsidiary: 'HQ',   toSubsidiary: 'APAC', amount: 500_000 }));

    const results = calculateNetting();
    expect(results[0]!.netAmount).toBeGreaterThanOrEqual(results[1]!.netAmount);
  });

  it('getNettingSummary returns correct aggregates', () => {
    addFlow(makeFlow({ fromSubsidiary: 'HQ',   toSubsidiary: 'EMEA', amount: 300_000 }));
    addFlow(makeFlow({ fromSubsidiary: 'EMEA', toSubsidiary: 'HQ',   amount: 100_000 }));

    const summary = getNettingSummary();
    expect(summary.totalGrossUsd).toBe(400_000);
    expect(summary.totalNetUsd).toBe(200_000);
    expect(summary.reductionPercent).toBe(50);
    expect(summary.pairsCount).toBe(1);
    expect(summary.flowsCount).toBe(2);
  });

  it('clearSettledFlows empties the queue', () => {
    addFlow(makeFlow({}));
    clearSettledFlows();
    expect(listFlows()).toHaveLength(0);
    expect(calculateNetting()).toHaveLength(0);
  });
});

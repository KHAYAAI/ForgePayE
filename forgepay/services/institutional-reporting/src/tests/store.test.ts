import { describe, it, expect, beforeEach } from 'vitest';
import { saveReport, getReport, listReports, deleteReport, clearReports, reportCount } from '../store';
import type { CashFlowReport } from '../types';

const PERIOD = { start: '2026-01-01', end: '2026-03-31' };

function makeCashFlowPayload(): CashFlowReport {
  return {
    period: PERIOD,
    enterpriseId: 'ent-001',
    operatingInflowsUsd: 1_000_000,
    operatingOutflowsUsd: 700_000,
    investingFlowsUsd: -100_000,
    financingFlowsUsd: 0,
    netChangeUsd: 200_000,
    beginningBalanceUsd: 5_000_000,
    endingBalanceUsd: 5_200_000,
    lineItems: [],
  };
}

describe('report store', () => {
  beforeEach(() => clearReports());

  it('saveReport returns metadata with id and generatedAt', () => {
    const meta = saveReport('cash_flow', PERIOD, makeCashFlowPayload());
    expect(meta.id).toBeDefined();
    expect(meta.type).toBe('cash_flow');
    expect(meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta.sizeBytes).toBeGreaterThan(0);
  });

  it('getReport returns the saved payload', () => {
    const meta = saveReport('cash_flow', PERIOD, makeCashFlowPayload());
    const stored = getReport(meta.id);
    expect(stored).toBeDefined();
    expect((stored!.payload as CashFlowReport).enterpriseId).toBe('ent-001');
  });

  it('getReport returns undefined for unknown id', () => {
    expect(getReport('does-not-exist')).toBeUndefined();
  });

  it('listReports returns newest first', () => {
    saveReport('cash_flow', PERIOD, makeCashFlowPayload());
    saveReport('netting', PERIOD, { period: PERIOD, totalGrossFlowsUsd: 0, totalNetFlowsUsd: 0, feesAvoidedUsd: 0, byPair: [], reductionPercent: 0 });
    const list = listReports();
    expect(list.length).toBe(2);
    // generatedAt order: newest first
    expect(list[0]!.generatedAt >= list[1]!.generatedAt).toBe(true);
  });

  it('deleteReport removes the entry', () => {
    const meta = saveReport('cash_flow', PERIOD, makeCashFlowPayload());
    expect(deleteReport(meta.id)).toBe(true);
    expect(getReport(meta.id)).toBeUndefined();
  });

  it('deleteReport returns false for unknown id', () => {
    expect(deleteReport('ghost')).toBe(false);
  });

  it('reportCount reflects saved count', () => {
    expect(reportCount()).toBe(0);
    saveReport('cash_flow', PERIOD, makeCashFlowPayload());
    saveReport('netting', PERIOD, { period: PERIOD, totalGrossFlowsUsd: 0, totalNetFlowsUsd: 0, feesAvoidedUsd: 0, byPair: [], reductionPercent: 0 });
    expect(reportCount()).toBe(2);
  });

  it('saveReport stores correlationId when provided', () => {
    const meta = saveReport('audit_trail', PERIOD, {
      period: PERIOD,
      totalEvents: 0,
      byActor: {},
      byAction: {},
      criticalEvents: [],
    }, 'corr-xyz');
    expect(meta.generatedByCorrelationId).toBe('corr-xyz');
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  addFlow,
  clearSettledFlows,
  generateSettlementInstructions,
  dispatchSettlementInstructions,
  getSettlementHistory,
} from '../netting';
import type { NettingFlow } from '../types';

function makeFlow(overrides: Partial<NettingFlow> = {}): NettingFlow {
  return {
    fromSubsidiary: 'HQ',
    toSubsidiary:   'EMEA',
    amount:         100_000,
    currency:       'USD',
    dueDate:        '2026-06-01',
    ...overrides,
  };
}

describe('settlement instructions', () => {
  beforeEach(() => clearSettledFlows());

  it('returns empty when no flows', () => {
    expect(generateSettlementInstructions()).toEqual([]);
  });

  it('skips dust amounts under $0.01', () => {
    addFlow(makeFlow({ amount: 100 }));
    addFlow(makeFlow({ fromSubsidiary: 'EMEA', toSubsidiary: 'HQ', amount: 100 })); // perfectly offsets
    expect(generateSettlementInstructions()).toEqual([]);
  });

  it('generates one instruction per non-zero pair', () => {
    addFlow(makeFlow({ amount: 300_000 }));
    addFlow(makeFlow({ fromSubsidiary: 'EMEA', toSubsidiary: 'HQ', amount: 100_000 }));
    const instr = generateSettlementInstructions();
    expect(instr).toHaveLength(1);
    expect(instr[0]!.amountUsd).toBe(200_000);
  });

  it('uses stablecoin for amounts >= $1M', () => {
    addFlow(makeFlow({ amount: 1_500_000 }));
    const instr = generateSettlementInstructions();
    expect(instr[0]!.method).toBe('stablecoin');
  });

  it('uses wire for amounts < $1M', () => {
    addFlow(makeFlow({ amount: 500_000 }));
    const instr = generateSettlementInstructions();
    expect(instr[0]!.method).toBe('wire');
  });

  it('preserves invoice refs from underlying flows', () => {
    addFlow(makeFlow({ amount: 100_000, invoiceRef: 'INV-001' }));
    addFlow(makeFlow({ amount: 200_000, invoiceRef: 'INV-002' }));
    const instr = generateSettlementInstructions();
    expect(instr[0]!.invoiceRefs).toEqual(['INV-001', 'INV-002']);
  });

  it('reference includes from→to subsidiary pair', () => {
    addFlow(makeFlow({ amount: 100_000 }));
    const instr = generateSettlementInstructions();
    expect(instr[0]!.reference).toMatch(/^NET-HQ-EMEA-\d{4}-\d{2}-\d{2}$/);
  });

  it('dispatches successful instructions and marks status', async () => {
    addFlow(makeFlow({ amount: 100_000 }));
    const instr = generateSettlementInstructions();

    const mockFetch = vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ transferId: 'tr-123' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await dispatchSettlementInstructions(instr, 'http://mock');
    expect(result[0]!.status).toBe('dispatched');
    expect(result[0]!.bankConnectivityRef).toBe('tr-123');
    expect(mockFetch).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it('marks failed when bank-connectivity rejects', async () => {
    addFlow(makeFlow({ amount: 100_000 }));
    const instr = generateSettlementInstructions();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    const result = await dispatchSettlementInstructions(instr, 'http://mock');
    expect(result[0]!.status).toBe('failed');

    vi.unstubAllGlobals();
  });

  it('records to history regardless of outcome', async () => {
    const historyBefore = getSettlementHistory().length;
    addFlow(makeFlow({ amount: 100_000 }));
    const instr = generateSettlementInstructions();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transferId: 'x' }) }));
    await dispatchSettlementInstructions(instr, 'http://mock');
    vi.unstubAllGlobals();

    expect(getSettlementHistory().length).toBe(historyBefore + 1);
  });
});

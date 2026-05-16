import { describe, it, expect } from 'vitest';
import { consolidateCashPosition } from '../consolidator';
import type { AccountBalance } from '../types';

const makeAccount = (overrides: Partial<AccountBalance>): AccountBalance => ({
  accountId:     'acct-1',
  bankName:      'Test Bank',
  accountName:   'Operating',
  accountType:   'checking',
  currency:      'USD',
  balanceNative: 1_000_000,
  balanceUsd:    1_000_000,
  subsidiary:    'HQ',
  lastUpdated:   new Date().toISOString(),
  ...overrides,
});

describe('consolidateCashPosition', () => {
  it('returns zero position for empty accounts', () => {
    const pos = consolidateCashPosition([]);
    expect(pos.totalUsd).toBe(0);
    expect(pos.idleCashUsd).toBe(0);
    expect(pos.bySubsidiary).toEqual({});
    expect(pos.byCurrency).toEqual({});
  });

  it('sums balances across all accounts', () => {
    const accounts = [
      makeAccount({ accountId: 'a1', balanceUsd: 1_000_000, subsidiary: 'HQ' }),
      makeAccount({ accountId: 'a2', balanceUsd: 500_000,   subsidiary: 'EMEA' }),
    ];
    const pos = consolidateCashPosition(accounts);
    expect(pos.totalUsd).toBe(1_500_000);
  });

  it('groups accounts by subsidiary', () => {
    const accounts = [
      makeAccount({ accountId: 'a1', balanceUsd: 600_000, subsidiary: 'HQ'   }),
      makeAccount({ accountId: 'a2', balanceUsd: 400_000, subsidiary: 'HQ'   }),
      makeAccount({ accountId: 'a3', balanceUsd: 200_000, subsidiary: 'APAC' }),
    ];
    const pos = consolidateCashPosition(accounts);
    expect(pos.bySubsidiary['HQ']!.totalUsd).toBe(1_000_000);
    expect(pos.bySubsidiary['HQ']!.accountCount).toBe(2);
    expect(pos.bySubsidiary['APAC']!.totalUsd).toBe(200_000);
  });

  it('groups accounts by currency', () => {
    const accounts = [
      makeAccount({ accountId: 'a1', currency: 'USD', balanceNative: 500_000, balanceUsd: 500_000 }),
      makeAccount({ accountId: 'a2', currency: 'EUR', balanceNative: 100_000, balanceUsd: 108_000 }),
    ];
    const pos = consolidateCashPosition(accounts);
    expect(pos.byCurrency['USD']!.balanceNative).toBe(500_000);
    expect(pos.byCurrency['EUR']!.balanceNative).toBe(100_000);
    expect(pos.byCurrency['EUR']!.accountCount).toBe(1);
  });

  it('deduplicates currencies per subsidiary', () => {
    const accounts = [
      makeAccount({ accountId: 'a1', currency: 'USD', subsidiary: 'HQ' }),
      makeAccount({ accountId: 'a2', currency: 'USD', subsidiary: 'HQ' }),
    ];
    const pos = consolidateCashPosition(accounts);
    expect(pos.bySubsidiary['HQ']!.currencies).toEqual(['USD']);
  });

  it('calculates idle and deployed yield estimates', () => {
    const accounts = [makeAccount({ balanceUsd: 10_000_000 })];
    const pos = consolidateCashPosition(accounts);
    // 40% idle, 10% deployed
    expect(pos.idleCashUsd).toBeCloseTo(4_000_000);
    expect(pos.deployedInYieldUsd).toBeCloseTo(1_000_000);
    // opportunity cost = idle * 4%
    expect(pos.opportunityCostUsdPerYear).toBeCloseTo(160_000);
  });

  it('assigns runwayDays of 999 when totalUsd is 0', () => {
    const accounts = [makeAccount({ balanceUsd: 0 })];
    const pos = consolidateCashPosition(accounts);
    // runway is 999 when burn is 0
    expect(pos.bySubsidiary['HQ']!.runwayDays).toBe(999);
  });

  it('includes lastConsolidated timestamp', () => {
    const pos = consolidateCashPosition([]);
    expect(pos.lastConsolidated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

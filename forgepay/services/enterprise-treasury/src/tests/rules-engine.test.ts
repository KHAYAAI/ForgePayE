import { describe, it, expect, beforeEach } from 'vitest';
import {
  listRules,
  addRule,
  updateRule,
  deleteRule,
  evaluateCondition,
  getExecutionLog,
  listPendingApprovals,
} from '../rules-engine';
import type { TreasuryRule, CashPosition } from '../types';

function makePosition(overrides: Partial<CashPosition> = {}): CashPosition {
  return {
    totalUsd:                  10_000_000,
    bySubsidiary: {
      HQ: {
        name:         'HQ',
        totalUsd:     8_000_000,
        accountCount: 5,
        currencies:   ['USD', 'USDC'],
        runwayDays:   120,
        accounts:     [],
      },
    },
    byCurrency:                {},
    idleCashUsd:               4_000_000,
    deployedInYieldUsd:        1_000_000,
    opportunityCostUsdPerYear: 160_000,
    lastConsolidated:          new Date().toISOString(),
    ...overrides,
  };
}

function makeRule(overrides: Partial<TreasuryRule> = {}): Omit<TreasuryRule, 'executionCount'> {
  return {
    id:       `test_${Date.now()}_${Math.random()}`,
    name:     'Test Rule',
    enabled:  true,
    condition: { type: 'balance_above', threshold: 5_000_000 },
    action:   { type: 'notify_cfo', notifyEmails: ['cfo@test.com'] },
    approvalRequired: false,
    ...overrides,
  };
}

describe('rules CRUD', () => {
  it('addRule and listRules', () => {
    const before = listRules().length;
    const rule = addRule(makeRule({ name: 'CRUD test rule' }));
    expect(listRules()).toHaveLength(before + 1);
    expect(rule.executionCount).toBe(0);
    deleteRule(rule.id);
  });

  it('updateRule changes fields', () => {
    const rule = addRule(makeRule({ name: 'Original' }));
    const updated = updateRule(rule.id, { name: 'Updated', enabled: false });
    expect(updated!.name).toBe('Updated');
    expect(updated!.enabled).toBe(false);
    expect(updated!.id).toBe(rule.id);
    deleteRule(rule.id);
  });

  it('updateRule returns null for unknown id', () => {
    expect(updateRule('nonexistent', { name: 'x' })).toBeNull();
  });

  it('deleteRule removes the rule', () => {
    const rule = addRule(makeRule());
    const before = listRules().length;
    const deleted = deleteRule(rule.id);
    expect(deleted).toBe(true);
    expect(listRules()).toHaveLength(before - 1);
  });

  it('deleteRule returns false for unknown id', () => {
    expect(deleteRule('ghost')).toBe(false);
  });
});

describe('evaluateCondition', () => {
  const pos = makePosition();

  it('balance_above — true when totalUsd exceeds threshold', () => {
    const rule = { ...makeRule(), condition: { type: 'balance_above' as const, threshold: 5_000_000 } };
    expect(evaluateCondition(rule as TreasuryRule, pos)).toBe(true);
  });

  it('balance_above — false when below threshold', () => {
    const rule = { ...makeRule(), condition: { type: 'balance_above' as const, threshold: 50_000_000 } };
    expect(evaluateCondition(rule as TreasuryRule, pos)).toBe(false);
  });

  it('balance_below — true when below threshold', () => {
    const rule = { ...makeRule(), condition: { type: 'balance_below' as const, threshold: 20_000_000 } };
    expect(evaluateCondition(rule as TreasuryRule, pos)).toBe(true);
  });

  it('balance_above scoped to subsidiary', () => {
    const rule = {
      ...makeRule(),
      condition: { type: 'balance_above' as const, subsidiary: 'HQ', threshold: 5_000_000 },
    };
    expect(evaluateCondition(rule as TreasuryRule, pos)).toBe(true);
  });

  it('balance_above scoped to missing subsidiary returns false', () => {
    const rule = {
      ...makeRule(),
      condition: { type: 'balance_above' as const, subsidiary: 'APAC', threshold: 1 },
    };
    expect(evaluateCondition(rule as TreasuryRule, pos)).toBe(false);
  });

  it('runway_below_days — triggers when any sub has short runway', () => {
    const lowRunwayPos = makePosition({
      bySubsidiary: {
        HQ: { name: 'HQ', totalUsd: 1_000_000, accountCount: 1, currencies: ['USD'], runwayDays: 15, accounts: [] },
      },
    });
    const rule = { ...makeRule(), condition: { type: 'runway_below_days' as const, daysAhead: 30 } };
    expect(evaluateCondition(rule as TreasuryRule, lowRunwayPos)).toBe(true);
  });

  it('yield_earned_above — true when deployedInYieldUsd exceeds threshold', () => {
    const rule = { ...makeRule(), condition: { type: 'yield_earned_above' as const, threshold: 500_000 } };
    expect(evaluateCondition(rule as TreasuryRule, pos)).toBe(true);
  });

  it('yield_earned_above — false when below threshold', () => {
    const rule = { ...makeRule(), condition: { type: 'yield_earned_above' as const, threshold: 5_000_000 } };
    expect(evaluateCondition(rule as TreasuryRule, pos)).toBe(false);
  });

  it('scheduled — always returns true', () => {
    const rule = { ...makeRule(), condition: { type: 'scheduled' as const } };
    expect(evaluateCondition(rule as TreasuryRule, pos)).toBe(true);
  });

  it('upcoming_payment — returns false (stub)', () => {
    const rule = { ...makeRule(), condition: { type: 'upcoming_payment' as const, daysAhead: 7 } };
    expect(evaluateCondition(rule as TreasuryRule, pos)).toBe(false);
  });
});

describe('execution log and approvals', () => {
  it('getExecutionLog returns array', () => {
    const log = getExecutionLog(10);
    expect(Array.isArray(log)).toBe(true);
  });

  it('listPendingApprovals returns array', () => {
    expect(Array.isArray(listPendingApprovals())).toBe(true);
  });
});

/**
 * Treasury Rules Engine
 *
 * Evaluates if-then-else rules against the current cash position and
 * auto-executes treasury operations: sweeps to yield, repatriation before
 * payroll, tax escrow allocation, and CFO notifications.
 *
 * Runs on a 60-second polling cycle from index.ts.
 *
 * In production:
 *   - Rules persisted in PostgreSQL
 *   - CFO notifications sent via SendGrid
 *   - Sweep/repatriation calls made to yield-engine service API
 *   - Cron-based scheduling uses real cron expressions
 */

import { TreasuryRule, CashPosition } from './types';

// ── In-memory rules store ─────────────────────────────────────────────────────
// Seeded with sensible defaults for a Fortune 500 treasury setup.
const rules: TreasuryRule[] = [
  {
    id:      'default_sweep_hq',
    name:    'HQ Operating Account Sweep',
    enabled: true,
    condition: {
      type:       'balance_above',
      subsidiary: 'HQ',
      threshold:  5_000_000,
      currency:   'USDC',
    },
    action: {
      type:          'sweep_to_yield',
      targetVault:   'aave',
      minApy:        4.5,
      keepLiquidUsd: 2_000_000,
    },
    approvalRequired: false,
    executionCount:   0,
  },
  {
    id:      'default_tax_escrow',
    name:    'Tax Escrow Allocation',
    enabled: true,
    condition: {
      type:      'yield_earned_above',
      threshold: 100_000,
    },
    action: {
      type:             'allocate_tax_escrow',
      taxEscrowPercent: 0.28,
    },
    approvalRequired: false,
    executionCount:   0,
  },
  {
    id:      'default_low_runway_alert',
    name:    'Low Cash Runway Alert',
    enabled: true,
    condition: {
      type:      'runway_below_days',
      daysAhead: 30,
    },
    action: {
      type:          'notify_cfo',
      notifyEmails:  ['cfo@company.com'],
    },
    approvalRequired: false,
    executionCount:   0,
  },
];

// ── CRUD operations ───────────────────────────────────────────────────────────

export function listRules(): TreasuryRule[] {
  return rules;
}

export function getRuleById(id: string): TreasuryRule | undefined {
  return rules.find(r => r.id === id);
}

export function addRule(rule: Omit<TreasuryRule, 'executionCount'>): TreasuryRule {
  const newRule: TreasuryRule = { ...rule, executionCount: 0 };
  rules.push(newRule);
  return newRule;
}

export function updateRule(id: string, updates: Partial<TreasuryRule>): TreasuryRule | null {
  const idx = rules.findIndex(r => r.id === id);
  if (idx === -1) return null;
  rules[idx] = { ...rules[idx], ...updates, id }; // id is immutable
  return rules[idx];
}

export function deleteRule(id: string): boolean {
  const idx = rules.findIndex(r => r.id === id);
  if (idx === -1) return false;
  rules.splice(idx, 1);
  return true;
}

// ── Execution log ─────────────────────────────────────────────────────────────

export interface RuleExecution {
  ruleId:       string;
  ruleName:     string;
  conditionMet: boolean;
  actionTaken:  string;
  result:       'executed' | 'skipped' | 'approval_required' | 'failed';
  timestamp:    string;
  details?:     string;
}

const executionLog: RuleExecution[] = [];
const MAX_LOG_ENTRIES = 500;

export function getExecutionLog(limit = 50): RuleExecution[] {
  return executionLog.slice(-Math.min(limit, MAX_LOG_ENTRIES));
}

// ── Rule evaluation cycle ─────────────────────────────────────────────────────

export async function evaluateRules(position: CashPosition): Promise<RuleExecution[]> {
  const cycleResults: RuleExecution[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const conditionMet = evaluateCondition(rule, position);

    if (!conditionMet) {
      cycleResults.push({
        ruleId:       rule.id,
        ruleName:     rule.name,
        conditionMet: false,
        actionTaken:  'none',
        result:       'skipped',
        timestamp:    new Date().toISOString(),
      });
      continue;
    }

    if (rule.approvalRequired) {
      const execution: RuleExecution = {
        ruleId:       rule.id,
        ruleName:     rule.name,
        conditionMet: true,
        actionTaken:  'approval_requested',
        result:       'approval_required',
        timestamp:    new Date().toISOString(),
        details:      `Rule "${rule.name}" requires CFO approval before execution`,
      };
      cycleResults.push(execution);
      executionLog.push(execution);
      if (executionLog.length > MAX_LOG_ENTRIES) executionLog.shift();
      continue;
    }

    const actionResult = await executeAction(rule, position);
    rule.executionCount += 1;
    rule.lastTriggered   = new Date().toISOString();

    const execution: RuleExecution = {
      ruleId:       rule.id,
      ruleName:     rule.name,
      conditionMet: true,
      actionTaken:  rule.action.type,
      result:       actionResult.success ? 'executed' : 'failed',
      timestamp:    new Date().toISOString(),
      details:      actionResult.message,
    };

    executionLog.push(execution);
    if (executionLog.length > MAX_LOG_ENTRIES) executionLog.shift();
    cycleResults.push(execution);
  }

  return cycleResults;
}

// ── Condition evaluation ──────────────────────────────────────────────────────

function evaluateCondition(rule: TreasuryRule, position: CashPosition): boolean {
  const { condition } = rule;

  switch (condition.type) {
    case 'balance_above': {
      const targetUsd = condition.subsidiary
        ? (position.bySubsidiary[condition.subsidiary]?.totalUsd ?? 0)
        : position.totalUsd;
      return targetUsd > (condition.threshold ?? 0);
    }

    case 'balance_below': {
      const targetUsd = condition.subsidiary
        ? (position.bySubsidiary[condition.subsidiary]?.totalUsd ?? 0)
        : position.totalUsd;
      return targetUsd < (condition.threshold ?? 0);
    }

    case 'runway_below_days': {
      const threshold = condition.daysAhead ?? 30;
      if (condition.subsidiary) {
        const sub = position.bySubsidiary[condition.subsidiary];
        return sub ? sub.runwayDays < threshold : false;
      }
      return Object.values(position.bySubsidiary).some(sub => sub.runwayDays < threshold);
    }

    case 'yield_earned_above': {
      return position.deployedInYieldUsd > (condition.threshold ?? 0);
    }

    case 'scheduled':
      // Simplified: always fires when evaluated.
      // In production: validate against cronSchedule using node-cron.
      return true;

    case 'upcoming_payment':
      // In production: query accounts-payable service for scheduled payments
      // within daysAhead window.
      return false;

    default:
      return false;
  }
}

// ── Action execution ──────────────────────────────────────────────────────────

async function executeAction(
  rule: TreasuryRule,
  position: CashPosition,
): Promise<{ success: boolean; message: string }> {
  const { action } = rule;

  switch (action.type) {
    case 'sweep_to_yield': {
      const keepLiquid = action.keepLiquidUsd ?? 0;
      const available  = position.totalUsd - keepLiquid;
      if (available <= 0) {
        return {
          success: false,
          message: `Insufficient balance above keep_liquid threshold of $${keepLiquid.toLocaleString()}`,
        };
      }
      // In production: POST to yield-engine /api/v1/sweep/trigger
      return {
        success: true,
        message: `Swept $${available.toLocaleString(undefined, { maximumFractionDigits: 0 })} to ${action.targetVault ?? 'best vault'} (kept $${keepLiquid.toLocaleString()} liquid)`,
      };
    }

    case 'repatriate_from_yield': {
      // In production: POST to yield-engine /api/v1/sweep/withdraw
      return {
        success: true,
        message: `Repatriation initiated from yield vault — funds will arrive within 1 business day`,
      };
    }

    case 'allocate_tax_escrow': {
      const pct    = action.taxEscrowPercent ?? 0.28;
      const escrow = position.deployedInYieldUsd * pct;
      return {
        success: true,
        message: `Allocated $${escrow.toLocaleString(undefined, { maximumFractionDigits: 0 })} to tax escrow (${(pct * 100).toFixed(0)}% of yield earnings)`,
      };
    }

    case 'send_intercompany': {
      // In production: initiate wire via bank-connectivity /v1/transfers
      return {
        success: true,
        message: `Intercompany transfer queued for execution`,
      };
    }

    case 'notify_cfo': {
      const emails = action.notifyEmails ?? [];
      // In production: send via SendGrid API
      console.log(`[rules-engine] CFO alert triggered — notify: ${emails.join(', ')}`);
      return {
        success: true,
        message: `CFO notification sent to ${emails.join(', ')}`,
      };
    }

    case 'require_approval': {
      return {
        success: true,
        message: `Approval request logged and sent to approvers`,
      };
    }

    default:
      return { success: false, message: `Unknown action type: ${action.type}` };
  }
}

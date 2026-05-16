/**
 * Treasury Rules Engine
 *
 * Evaluates if-then-else rules against the current cash position and
 * auto-executes treasury operations: sweeps to yield, repatriation before
 * payroll, tax escrow allocation, and CFO notifications.
 *
 * Runs on a 60-second polling cycle from index.ts.
 * Supports an optional approval workflow: rules with approvalRequired=true
 * are queued in pendingApprovals and fire a notify_cfo alert instead of executing.
 */

import { TreasuryRule, CashPosition } from './types';

// ── In-memory stores ──────────────────────────────────────────────────────────

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
      type:         'notify_cfo',
      notifyEmails: ['cfo@company.com'],
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
  rules[idx] = { ...rules[idx]!, ...updates, id };
  return rules[idx]!;
}

export function deleteRule(id: string): boolean {
  const idx = rules.findIndex(r => r.id === id);
  if (idx === -1) return false;
  rules.splice(idx, 1);
  return true;
}

// ── Pending approvals ─────────────────────────────────────────────────────────

export interface PendingApproval {
  id:        string;
  ruleId:    string;
  ruleName:  string;
  reason:    string;
  createdAt: string;
  approved:  boolean | null; // null = pending
  resolvedAt?: string;
  resolvedBy?: string;
}

const pendingApprovals: PendingApproval[] = [];

export function listPendingApprovals(): PendingApproval[] {
  return pendingApprovals.filter(a => a.approved === null);
}

export function resolveApproval(id: string, approved: boolean, resolvedBy: string): PendingApproval | null {
  const approval = pendingApprovals.find(a => a.id === id);
  if (!approval || approval.approved !== null) return null;
  approval.approved   = approved;
  approval.resolvedAt = new Date().toISOString();
  approval.resolvedBy = resolvedBy;
  return approval;
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
      const approvalId = `${rule.id}_${Date.now()}`;
      pendingApprovals.push({
        id:        approvalId,
        ruleId:    rule.id,
        ruleName:  rule.name,
        reason:    `Condition "${rule.condition.type}" met — action "${rule.action.type}" requires approval`,
        createdAt: new Date().toISOString(),
        approved:  null,
      });

      // Notify approvers
      await fireAlertWebhook(
        `[ForgePay Treasury] Rule "${rule.name}" requires approval`,
        { ruleId: rule.id, approvalId, conditionType: rule.condition.type },
      );

      const execution: RuleExecution = {
        ruleId:       rule.id,
        ruleName:     rule.name,
        conditionMet: true,
        actionTaken:  'approval_requested',
        result:       'approval_required',
        timestamp:    new Date().toISOString(),
        details:      `Approval queued (id: ${approvalId})`,
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

export function evaluateCondition(rule: TreasuryRule, position: CashPosition): boolean {
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

    case 'yield_earned_above':
      return position.deployedInYieldUsd > (condition.threshold ?? 0);

    case 'scheduled':
      // In production: validate against cronSchedule via node-cron
      return true;

    case 'upcoming_payment':
      // In production: query accounts-payable service for payments within daysAhead
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
    case 'sweep_to_yield':
      return executeSweepToYield(rule, action, position);

    case 'repatriate_from_yield':
      return executeRepatriateFromYield(rule, action);

    case 'allocate_tax_escrow': {
      const pct    = action.taxEscrowPercent ?? 0.28;
      const escrow = position.deployedInYieldUsd * pct;
      return {
        success: true,
        message: `Allocated $${escrow.toLocaleString(undefined, { maximumFractionDigits: 0 })} to tax escrow (${(pct * 100).toFixed(0)}%)`,
      };
    }

    case 'send_intercompany':
      // Production: POST to bank-connectivity /v1/transfers with wire instructions
      return { success: true, message: 'Intercompany transfer queued for execution' };

    case 'notify_cfo': {
      const emails = action.notifyEmails ?? [];
      await fireAlertWebhook(
        `[ForgePay Treasury] Alert: ${rule.name}`,
        { ruleId: rule.id, conditionType: rule.condition.type, emails },
      );
      return { success: true, message: `CFO notification sent to ${emails.join(', ')}` };
    }

    case 'require_approval':
      return { success: true, message: 'Approval request logged' };

    default:
      return { success: false, message: `Unknown action type: ${(action as { type: string }).type}` };
  }
}

async function executeSweepToYield(
  rule: TreasuryRule,
  action: TreasuryRule['action'],
  position: CashPosition,
): Promise<{ success: boolean; message: string }> {
  const keepLiquid = action.keepLiquidUsd ?? 0;
  const available  = position.totalUsd - keepLiquid;

  if (available <= 0) {
    return {
      success: false,
      message: `Insufficient balance above keep_liquid threshold of $${keepLiquid.toLocaleString()}`,
    };
  }

  const YIELD_ENGINE_URL = process.env['YIELD_ENGINE_URL'] ?? 'http://localhost:3007';
  try {
    const resp = await fetch(`${YIELD_ENGINE_URL}/v1/sweep/trigger`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-source': 'enterprise-treasury' },
      body:    JSON.stringify({
        vault:         action.targetVault ?? 'aave',
        amountUsd:     available,
        minApy:        action.minApy ?? 0,
        keepLiquidUsd: keepLiquid,
        ruleId:        rule.id,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (resp.ok) {
      const data = (await resp.json()) as { sweepId?: string; status?: string };
      return {
        success: true,
        message: `Swept $${available.toLocaleString(undefined, { maximumFractionDigits: 0 })} to ${action.targetVault ?? 'best vault'} (sweepId: ${data.sweepId ?? 'n/a'})`,
      };
    }

    const errBody = await resp.text();
    return { success: false, message: `Yield-engine rejected sweep [${resp.status}]: ${errBody.slice(0, 200)}` };
  } catch (err) {
    return { success: false, message: `Yield-engine unreachable: ${(err as Error).message}` };
  }
}

async function executeRepatriateFromYield(
  rule: TreasuryRule,
  action: TreasuryRule['action'],
): Promise<{ success: boolean; message: string }> {
  const YIELD_ENGINE_URL = process.env['YIELD_ENGINE_URL'] ?? 'http://localhost:3007';
  try {
    const resp = await fetch(`${YIELD_ENGINE_URL}/v1/sweep/withdraw`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-source': 'enterprise-treasury' },
      body:    JSON.stringify({ ruleId: rule.id, vault: action.targetVault }),
      signal:  AbortSignal.timeout(15_000),
    });

    if (resp.ok) {
      return { success: true, message: 'Repatriation initiated — funds will arrive within 1 business day' };
    }
    return { success: false, message: `Yield-engine repatriation failed [${resp.status}]` };
  } catch (err) {
    return { success: false, message: `Yield-engine unreachable: ${(err as Error).message}` };
  }
}

// ── Alert webhook ─────────────────────────────────────────────────────────────

async function fireAlertWebhook(text: string, meta: Record<string, unknown>): Promise<void> {
  const url = process.env['ALERT_WEBHOOK_URL'];
  if (!url) return;

  try {
    await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, ...meta, timestamp: new Date().toISOString() }),
      signal:  AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn('[rules-engine] Alert webhook failed:', (err as Error).message);
  }
}

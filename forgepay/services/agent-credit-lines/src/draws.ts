/**
 * Credit Draw Engine
 *
 * Pure state-transition functions for the draw lifecycle:
 *   1. createDraw         — debit a line, compute interest, set dueAt
 *   2. repayDraw          — apply (partial) repayment, flip status when cleared
 *   3. checkOverdueAndDefault — sweep outstanding draws past their dueAt
 *
 * Interest model: simple interest accrued at draw time.
 *   totalOwed = principal × (1 + rateBps/10000 × termsDays/365)
 *
 * Default policy:
 *   dueAt + 0d  → status='overdue'
 *   dueAt + 14d → status='defaulted', DefaultRecord written, penalty webhook fired
 */

import {
  CreditDraw,
  CreditLine,
  DefaultRecord,
} from './types';
import {
  getCreditLine,
  putCreditLine,
  putDraw,
  getDraw,
  listDraws,
  addDefault,
} from './store';

const AGENT_IDENTITY_URL  = process.env['AGENT_IDENTITY_URL'] ?? 'http://localhost:3010';
const DEFAULT_GRACE_DAYS  = 14;
const MS_PER_DAY          = 86_400_000;
const PENALTY_TIMEOUT_MS  = 5_000;

const round2 = (n: number): number => Math.round(n * 100) / 100;

let drawCounter = 0;
const nextDrawId = (): string => `draw_${Date.now().toString(36)}_${(++drawCounter).toString(36)}`;

export interface CreateDrawInput {
  creditLineId:        string;
  amountUsd:           number;
  purpose:             string;
  counterpartyAgentId?: string;
}

export class DrawError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'DrawError';
  }
}

export function createDraw(input: CreateDrawInput): CreditDraw {
  const line = getCreditLine(input.creditLineId);
  if (!line) throw new DrawError(`Credit line ${input.creditLineId} not found`, 'line_not_found');
  if (line.status !== 'active') throw new DrawError(`Credit line is ${line.status}`, 'line_not_active');
  if (input.amountUsd <= 0)     throw new DrawError('Draw amount must be positive', 'invalid_amount');
  if (input.amountUsd > line.availableUsd) {
    throw new DrawError(
      `Draw amount ${input.amountUsd} exceeds available credit ${line.availableUsd}`,
      'insufficient_credit',
    );
  }

  const now      = new Date();
  const drawnAt  = now.toISOString();
  const dueAt    = new Date(now.getTime() + line.termsDays * MS_PER_DAY).toISOString();
  const interest = (line.interestRateBps / 10_000) * (line.termsDays / 365);
  const totalOwedUsd = round2(input.amountUsd * (1 + interest));

  const draw: CreditDraw = {
    id:            nextDrawId(),
    creditLineId:  line.id,
    agentId:       line.agentId,
    amountUsd:     round2(input.amountUsd),
    totalOwedUsd,
    repaidUsd:     0,
    drawnAt,
    dueAt,
    status:        'outstanding',
    purpose:       input.purpose,
    ...(input.counterpartyAgentId ? { counterpartyAgentId: input.counterpartyAgentId } : {}),
  };

  // Debit the credit line
  const updatedLine: CreditLine = {
    ...line,
    usedUsd:      round2(line.usedUsd + draw.amountUsd),
    availableUsd: round2(line.availableUsd - draw.amountUsd),
  };
  putCreditLine(updatedLine);
  putDraw(draw);

  return draw;
}

export interface RepayResult {
  draw:              CreditDraw;
  appliedUsd:        number;
  remainingOwedUsd:  number;
  fullyRepaid:       boolean;
}

export function repayDraw(drawId: string, amountUsd: number): RepayResult {
  const draw = getDraw(drawId);
  if (!draw) throw new DrawError(`Draw ${drawId} not found`, 'draw_not_found');
  if (amountUsd <= 0) throw new DrawError('Repayment amount must be positive', 'invalid_amount');
  if (draw.status === 'repaid') throw new DrawError('Draw already repaid', 'already_repaid');
  if (draw.status === 'defaulted') throw new DrawError('Draw is in default; recoveries handled separately', 'in_default');

  const remainingBefore = round2(draw.totalOwedUsd - draw.repaidUsd);
  const applied         = round2(Math.min(amountUsd, remainingBefore));
  const newRepaid       = round2(draw.repaidUsd + applied);
  const remainingAfter  = round2(draw.totalOwedUsd - newRepaid);

  const fullyRepaid = remainingAfter <= 0.01;

  const updated: CreditDraw = {
    ...draw,
    repaidUsd: newRepaid,
    status:    fullyRepaid ? 'repaid' : draw.status,
    ...(fullyRepaid ? { repaidAt: new Date().toISOString() } : {}),
  };
  putDraw(updated);

  // Replenish available credit by the principal portion proportional to repayment
  // (Simplification: full principal returns when totalOwed is fully repaid.)
  if (fullyRepaid) {
    const line = getCreditLine(updated.creditLineId);
    if (line) {
      putCreditLine({
        ...line,
        usedUsd:      round2(Math.max(0, line.usedUsd - updated.amountUsd)),
        availableUsd: round2(Math.min(line.limitUsd, line.availableUsd + updated.amountUsd)),
      });
    }
  }

  return {
    draw:             updated,
    appliedUsd:       applied,
    remainingOwedUsd: fullyRepaid ? 0 : remainingAfter,
    fullyRepaid,
  };
}

export interface OverdueSweepResult {
  overdue:   number;
  defaulted: number;
  defaultedDrawIds: string[];
}

async function firePenaltyWebhook(agentId: string, lossUsd: number): Promise<void> {
  try {
    await fetch(`${AGENT_IDENTITY_URL}/v1/agents/${encodeURIComponent(agentId)}/penalty`, {
      method:  'POST',
      signal:  AbortSignal.timeout(PENALTY_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'x-source':     'agent-credit-lines',
      },
      body: JSON.stringify({ reasonCode: 'default', amount: lossUsd }),
    });
  } catch {
    // Best-effort: never let a downstream failure block the sweep.
  }
}

export async function checkOverdueAndDefault(now: Date = new Date()): Promise<OverdueSweepResult> {
  const result: OverdueSweepResult = { overdue: 0, defaulted: 0, defaultedDrawIds: [] };
  const nowMs = now.getTime();

  for (const draw of listDraws()) {
    if (draw.status !== 'outstanding' && draw.status !== 'overdue') continue;

    const dueMs = new Date(draw.dueAt).getTime();
    if (nowMs <= dueMs) continue;

    const ageDays = (nowMs - dueMs) / MS_PER_DAY;

    if (ageDays > DEFAULT_GRACE_DAYS) {
      const lossUsd = round2(Math.max(0, draw.totalOwedUsd - draw.repaidUsd));
      const updated: CreditDraw = { ...draw, status: 'defaulted' };
      putDraw(updated);

      const record: DefaultRecord = {
        drawId:             draw.id,
        agentId:            draw.agentId,
        defaultedAt:        now.toISOString(),
        recoveredAmountUsd: round2(draw.repaidUsd),
        lossUsd,
      };
      addDefault(record);
      result.defaulted += 1;
      result.defaultedDrawIds.push(draw.id);

      // Fire-and-forget penalty notification
      void firePenaltyWebhook(draw.agentId, lossUsd);
    } else if (draw.status === 'outstanding') {
      putDraw({ ...draw, status: 'overdue' });
      result.overdue += 1;
    }
  }

  return result;
}

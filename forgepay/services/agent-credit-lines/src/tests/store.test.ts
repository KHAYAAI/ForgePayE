import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetStore,
  putCreditLine,
  getCreditLine,
  listCreditLines,
  listCreditLinesByAgent,
  deleteCreditLine,
  putDraw,
  getDraw,
  listDraws,
  listDrawsByLine,
  addDefault,
  listDefaults,
} from '../store';
import type { CreditLine, CreditDraw, DefaultRecord } from '../types';

const makeLine = (overrides: Partial<CreditLine> = {}): CreditLine => ({
  id:              'cl_1',
  agentId:         'agent_a',
  limitUsd:        10_000,
  availableUsd:    10_000,
  usedUsd:         0,
  termsDays:       30,
  interestRateBps: 900,
  status:          'active',
  createdAt:       new Date().toISOString(),
  ...overrides,
});

const makeDraw = (overrides: Partial<CreditDraw> = {}): CreditDraw => ({
  id:           'draw_1',
  creditLineId: 'cl_1',
  agentId:      'agent_a',
  amountUsd:    1_000,
  totalOwedUsd: 1_073.97,
  repaidUsd:    0,
  drawnAt:      new Date().toISOString(),
  dueAt:        new Date(Date.now() + 30 * 86_400_000).toISOString(),
  status:       'outstanding',
  purpose:      'compute',
  ...overrides,
});

describe('store', () => {
  beforeEach(() => _resetStore());

  it('persists and retrieves a credit line', () => {
    putCreditLine(makeLine({ id: 'cl_x' }));
    expect(getCreditLine('cl_x')?.id).toBe('cl_x');
    expect(listCreditLines()).toHaveLength(1);
  });

  it('filters credit lines by agent', () => {
    putCreditLine(makeLine({ id: 'cl_a', agentId: 'agent_a' }));
    putCreditLine(makeLine({ id: 'cl_b', agentId: 'agent_b' }));
    putCreditLine(makeLine({ id: 'cl_c', agentId: 'agent_a' }));
    expect(listCreditLinesByAgent('agent_a')).toHaveLength(2);
    expect(listCreditLinesByAgent('agent_b')).toHaveLength(1);
    expect(listCreditLinesByAgent('agent_z')).toHaveLength(0);
  });

  it('deletes a credit line and reports success/failure', () => {
    putCreditLine(makeLine({ id: 'cl_del' }));
    expect(deleteCreditLine('cl_del')).toBe(true);
    expect(deleteCreditLine('cl_del')).toBe(false);
    expect(getCreditLine('cl_del')).toBeUndefined();
  });

  it('persists draws and filters by line', async () => {
    putDraw(makeDraw({ id: 'd1', creditLineId: 'cl_1' }));
    putDraw(makeDraw({ id: 'd2', creditLineId: 'cl_2' }));
    putDraw(makeDraw({ id: 'd3', creditLineId: 'cl_1' }));
    expect(getDraw('d1')?.id).toBe('d1');
    expect(listDraws()).toHaveLength(3);
    expect(await listDrawsByLine('cl_1')).toHaveLength(2);
  });

  it('records defaults and returns a copy of the list', () => {
    const rec: DefaultRecord = {
      drawId:             'd1',
      agentId:            'agent_a',
      defaultedAt:        new Date().toISOString(),
      recoveredAmountUsd: 0,
      lossUsd:            500,
    };
    addDefault(rec);
    const all = listDefaults();
    expect(all).toHaveLength(1);
    all.push({ ...rec, drawId: 'mutation' });
    // listDefaults should return an independent copy
    expect(listDefaults()).toHaveLength(1);
  });
});

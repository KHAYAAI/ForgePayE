/**
 * Paying furnishers: what must not happen.
 *
 * Every assertion here is about money going out wrongly rather than about the
 * happy path working. A furnisher must not be paid for an attribution a dispute
 * reversed, must not be paid twice for the same period, must not be paid for
 * credits it already received, and must not be quietly skipped when it is owed
 * cash but has nowhere to receive it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  payoutPeriod, previousPeriod, isPeriodClosed, unsettledEntriesFor,
  previewPeriod, payoutExternalId, settleFurnisherPeriod,
} from './furnisher-payouts';
import { setContributor, contributors, attributions, recordAttribution, listAttributions } from './store';
import type { AttributionEntry, DataContributor } from './types';

const ADDRESS = '0x1234567890123456789012345678901234567890';
const NOW = new Date('2026-09-09T00:00:00Z');
const PERIOD = '2026-08';          // closed relative to NOW
const OPEN_PERIOD = '2026-09';     // the period NOW falls in

function contributor(id: string, over: Partial<DataContributor> = {}): DataContributor {
  return {
    id, name: `Furnisher ${id}`, type: 'lending_protocol',
    apiKeyHash: 'hash', permissions: [], queriesUsed: 0, queriesAllowed: 100,
    dataRecordsContributed: 10, createdAt: '2026-01-01T00:00:00Z', status: 'active',
    payoutAddress: ADDRESS,
    ...over,
  } as DataContributor;
}

let entrySeq = 0;
function entry(contributorId: string, cents: number, over: Partial<AttributionEntry> = {}): AttributionEntry {
  return {
    id: `attr_${++entrySeq}`,
    contributorId,
    reportId: 'rep_1',
    agentId: 'agent_1',
    share: 1,
    amountUsdCents: cents,
    creditsAccrued: 0,
    phase: 'cash',
    createdAt: '2026-08-15T00:00:00Z',
    ...over,
  };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  contributors.clear();
  attributions.clear();
  entrySeq = 0;
  process.env['STABLECOIN_GATEWAY_URL'] = 'https://gateway.test';
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

function mockGateway(impl?: (body: any) => any) {
  const fn = vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const custom = impl?.(body);
    if (custom) return custom;
    return {
      ok: true,
      json: async () => ({
        data: { id: `payout_${body.external_id}`, status: 'approved' },
        deduplicated: false,
        requires_approval: false,
      }),
    };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

// ── Periods ───────────────────────────────────────────────────────────────────

describe('periods', () => {
  it('derives a YYYY-MM period in UTC', () => {
    expect(payoutPeriod(new Date('2026-08-15T00:00:00Z'))).toBe('2026-08');
    expect(payoutPeriod('2026-01-01T00:00:00Z')).toBe('2026-01');
  });

  it('rolls the previous period back across a year boundary', () => {
    expect(previousPeriod(new Date('2026-01-10T00:00:00Z'))).toBe('2025-12');
  });

  it('treats the current period as open and a past one as closed', () => {
    expect(isPeriodClosed(OPEN_PERIOD, NOW)).toBe(false);
    expect(isPeriodClosed(PERIOD, NOW)).toBe(true);
  });
});

// ── What counts as owed ───────────────────────────────────────────────────────

describe('unsettledEntriesFor', () => {
  beforeEach(() => { setContributor(contributor('c1')); });

  it('counts unsettled cash entries in the period', () => {
    recordAttribution(entry('c1', 70));
    recordAttribution(entry('c1', 30));
    expect(unsettledEntriesFor('c1', PERIOD)).toHaveLength(2);
  });

  it('excludes an attribution a dispute reversed', () => {
    // The clawback rule from furnisher-comp has to survive all the way to the
    // payment, or the reversal is cosmetic.
    recordAttribution(entry('c1', 70, { reversedAt: '2026-08-20T00:00:00Z', reversalReason: 'disputed' }));
    expect(unsettledEntriesFor('c1', PERIOD)).toHaveLength(0);
  });

  it('excludes reciprocity-phase entries, which were already paid in credits', () => {
    recordAttribution(entry('c1', 0, { phase: 'reciprocity', creditsAccrued: 0.5 }));
    expect(unsettledEntriesFor('c1', PERIOD)).toHaveLength(0);
  });

  it('excludes entries already settled', () => {
    recordAttribution(entry('c1', 70, { settlementId: 'run_1', settledAt: '2026-09-01T00:00:00Z' }));
    expect(unsettledEntriesFor('c1', PERIOD)).toHaveLength(0);
  });

  it('excludes entries from a different period', () => {
    recordAttribution(entry('c1', 70, { createdAt: '2026-07-15T00:00:00Z' }));
    expect(unsettledEntriesFor('c1', PERIOD)).toHaveLength(0);
  });
});

// ── The open-period guard ─────────────────────────────────────────────────────

describe('settleFurnisherPeriod — refusing an open period', () => {
  it('refuses to settle a period that has not ended', async () => {
    // The most important guard in the module. The idempotency key is
    // per-period; spending it on a partial total strands every entry accrued
    // afterwards, with no error raised anywhere.
    setContributor(contributor('c1'));
    recordAttribution(entry('c1', 70, { createdAt: '2026-09-05T00:00:00Z' }));
    const fetchMock = mockGateway();

    const result = await settleFurnisherPeriod(OPEN_PERIOD, NOW);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('period_open');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses when no gateway is configured rather than dropping the debt', async () => {
    delete process.env['STABLECOIN_GATEWAY_URL'];
    const result = await settleFurnisherPeriod(PERIOD, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_configured');
  });
});

// ── Paying ────────────────────────────────────────────────────────────────────

describe('settleFurnisherPeriod — paying a closed period', () => {
  it('sends one payout per furnisher summing its entries', async () => {
    setContributor(contributor('c1'));
    recordAttribution(entry('c1', 70));
    recordAttribution(entry('c1', 55));
    const fetchMock = mockGateway();

    const result = await settleFurnisherPeriod(PERIOD, NOW);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.amount_usdc).toBeCloseTo(1.25, 6);
    expect(body.payee_address).toBe(ADDRESS);
    if (result.ok) expect(result.totalPaidUsdCents).toBe(125);
  });

  it('uses a stable per-period idempotency key', () => {
    expect(payoutExternalId('c1', '2026-08')).toBe('furnisher_c1_2026-08');
    expect(payoutExternalId('c1', '2026-08')).toBe(payoutExternalId('c1', '2026-08'));
    expect(payoutExternalId('c1', '2026-09')).not.toBe(payoutExternalId('c1', '2026-08'));
  });

  it('marks entries settled so a second run pays nothing', async () => {
    setContributor(contributor('c1'));
    recordAttribution(entry('c1', 70));
    const fetchMock = mockGateway();

    await settleFurnisherPeriod(PERIOD, NOW);
    expect(unsettledEntriesFor('c1', PERIOD)).toHaveLength(0);

    const second = await settleFurnisherPeriod(PERIOD, NOW);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (second.ok) expect(second.totalPaidUsdCents).toBe(0);
  });

  it('leaves entries unsettled when the gateway call fails', async () => {
    // If a failed call marked them paid, the debt would vanish. The retry is
    // safe because the idempotency key is stable.
    setContributor(contributor('c1'));
    recordAttribution(entry('c1', 70));
    mockGateway(() => ({ ok: false, status: 502 }));

    const result = await settleFurnisherPeriod(PERIOD, NOW);

    expect(unsettledEntriesFor('c1', PERIOD)).toHaveLength(1);
    if (result.ok) {
      expect(result.failedCount).toBe(1);
      expect(result.totalPaidUsdCents).toBe(0);
    }
  });

  it('leaves entries unsettled when the gateway throws', async () => {
    setContributor(contributor('c1'));
    recordAttribution(entry('c1', 70));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection reset'); }));

    const result = await settleFurnisherPeriod(PERIOD, NOW);

    expect(unsettledEntriesFor('c1', PERIOD)).toHaveLength(1);
    if (result.ok) expect(result.failedCount).toBe(1);
  });

  it('surfaces a deduplicated payout rather than counting it as a fresh transfer', async () => {
    setContributor(contributor('c1'));
    recordAttribution(entry('c1', 70));
    mockGateway(() => ({
      ok: true,
      json: async () => ({ data: { id: 'payout_existing', status: 'approved' }, deduplicated: true, requires_approval: false }),
    }));

    const result = await settleFurnisherPeriod(PERIOD, NOW);
    if (result.ok) expect(result.lines[0]!.deduplicated).toBe(true);
  });
});

// ── Furnishers that cannot be paid ────────────────────────────────────────────

describe('unpayable furnishers', () => {
  it('reports a cash-owed furnisher with no payout address instead of skipping it', async () => {
    setContributor(contributor('c1', { payoutAddress: undefined }));
    recordAttribution(entry('c1', 70));
    const fetchMock = mockGateway();

    const result = await settleFurnisherPeriod(PERIOD, NOW);

    expect(fetchMock).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.blockedCount).toBe(1);
      expect(result.lines[0]!.blocked).toBe('no_payout_address');
      // Still owed — not marked settled.
      expect(unsettledEntriesFor('c1', PERIOD)).toHaveLength(1);
    }
  });

  it('does not pay a suspended contributor', async () => {
    setContributor(contributor('c1', { status: 'suspended' }));
    recordAttribution(entry('c1', 70));
    const fetchMock = mockGateway();

    const result = await settleFurnisherPeriod(PERIOD, NOW);

    expect(fetchMock).not.toHaveBeenCalled();
    if (result.ok) expect(result.lines[0]!.blocked).toBe('contributor_suspended');
  });
});

// ── Preview ───────────────────────────────────────────────────────────────────

describe('previewPeriod', () => {
  it('lists what is owed largest first, including unpayable lines', async () => {
    setContributor(contributor('small'));
    setContributor(contributor('big'));
    setContributor(contributor('blocked', { payoutAddress: undefined }));
    recordAttribution(entry('small', 10));
    recordAttribution(entry('big', 900));
    recordAttribution(entry('blocked', 500));

    const lines = previewPeriod(PERIOD);

    expect(lines.map(l => l.contributorId)).toEqual(['big', 'blocked', 'small']);
    expect(lines.find(l => l.contributorId === 'blocked')!.blocked).toBe('no_payout_address');
  });

  it('is empty when nothing is owed', () => {
    setContributor(contributor('c1'));
    expect(previewPeriod(PERIOD)).toEqual([]);
  });

  it('does not mutate the ledger', () => {
    setContributor(contributor('c1'));
    recordAttribution(entry('c1', 70));
    previewPeriod(PERIOD);
    expect(listAttributions().every(e => !e.settlementId)).toBe(true);
  });
});

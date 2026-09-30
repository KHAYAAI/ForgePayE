/**
 * The bureau paying and being paid in ZARP and OUSD as well as USDC.
 *
 * The ledger stays USD cents. What these guard is the edges: that a top-up or a
 * payout in one token can't be silently turned into another (an older gateway that
 * ignores `asset` would do exactly that), that dollars are only credited for what
 * was actually paid in the token that was asked for, and that a furnisher gets the
 * token it chose.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { requestTopUp, confirmTopUp, getAccountSummary, centsToUsd, defaultAsset } from './billing';
import { getTopUpReceipt, setContributor, contributors, attributions, recordAttribution } from './store';
import { settleFurnisherPeriod, payoutAssetFor, previewPeriod } from './furnisher-payouts';
import type { AttributionEntry, DataContributor } from './types';

const originalEnv = { ...process.env };
beforeEach(() => { process.env['STABLECOIN_GATEWAY_URL'] = 'https://gateway.test'; process.env['STABLECOIN_GATEWAY_API_KEY'] = 'k'; });
afterEach(() => { process.env = { ...originalEnv }; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const ZARP_QUOTE = {
  receipt_id: 'rcpt_z', deposit_id: 'dep_z', pay_to: '0x00000000000000000000000000000000000000aa',
  asset: { symbol: 'ZARP', chain: 'base', contract: '0xb755506531786C8aC63B756BaB1ac387bACB0C04', decimals: 18, unit: 'ZAR' },
  amount_usd: 10, amount_asset: '185', amount_units: (185n * 10n ** 18n).toString(),
  fx: { pair: 'USD/ZAR', rate: '18.5', as_of: '2026-09-30T00:00:00Z', source: 'ops' },
  chain: 'base', token: 'ZARP', expires_at: '2026-09-30T00:05:00Z', status: 'pending',
};

function gateway(routes: (url: string, init: any) => { ok?: boolean; status?: number; body: unknown }) {
  const fn = vi.fn(async (url: string, init: any) => {
    const r = routes(String(url), init ?? {});
    const ok = r.ok ?? true;
    return { ok, status: r.status ?? (ok ? 200 : 500), json: async () => r.body, text: async () => JSON.stringify(r.body) };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const sent = (fn: { mock: { calls: any[][] } }, i = 0) => JSON.parse(fn.mock.calls[i]![1].body);

describe('top-ups in ZARP and OUSD', () => {
  it('asks the gateway for the chosen asset in dollars, and keeps what it quoted', async () => {
    const fn = gateway(() => ({ body: ZARP_QUOTE }));
    const out = await requestTopUp('req_a', 10, 'ZARP');
    expect(out.ok).toBe(true);
    const body = sent(fn);
    expect(body).toMatchObject({ asset: 'ZARP', amount_usd: 10, chain: 'base', merchant_id: 'forgepay-credit-bureau' });
    expect(body).not.toHaveProperty('amount_usdc'); // an old gateway would read this and quote USDC
    expect(fn.mock.calls[0]![1].headers['x-api-key']).toBe('k');
    if (!out.ok) return;
    expect(out.gateway).toMatchObject({ payTo: ZARP_QUOTE.pay_to, asset: 'ZARP', amountAsset: '185', fxRate: '18.5', decimals: 18 });
    expect(getTopUpReceipt('rcpt_z')).toMatchObject({
      asset: 'ZARP', amountUsd: 10, assetUnits: ZARP_QUOTE.amount_units, fxRate: '18.5', payTo: ZARP_QUOTE.pay_to, contract: ZARP_QUOTE.asset.contract,
    });
  });

  it('a USDC top-up still sends the older field too, for gateways that predate assets', async () => {
    const fn = gateway(() => ({ body: { receipt_id: 'rcpt_u', deposit_id: 'd', amount_units: '5000000', chain: 'base', token: 'USDC', expires_at: 'x', status: 'pending' } }));
    const out = await requestTopUp('req_b', 5, 'USDC');
    expect(out.ok).toBe(true);
    expect(sent(fn)).toMatchObject({ asset: 'USDC', amount_usd: 5, amount_usdc: 5 });
  });

  it('refuses a gateway that answers in a different token than asked, and records nothing', async () => {
    // What an older gateway does: ignores `asset` and quotes USDC.
    gateway(() => ({ body: { receipt_id: 'rcpt_old', deposit_id: 'd', amount_units: '10000000', chain: 'base', token: 'USDC', expires_at: 'x', status: 'pending' } }));
    const out = await requestTopUp('req_c', 10, 'ZARP');
    expect(out).toMatchObject({ ok: false, reason: 'asset_unavailable' });
    expect(getTopUpReceipt('rcpt_old')).toBeUndefined();
  });

  it('reports an asset the gateway cannot quote right now (no rand rate) as unavailable, with its reason', async () => {
    gateway(() => ({ ok: false, status: 503, body: { error: 'RateUnavailable', message: 'no USD/ZAR rate has been set, so ZARP cannot be priced' } }));
    const out = await requestTopUp('req_d', 10, 'ZARP');
    expect(out).toMatchObject({ ok: false, reason: 'asset_unavailable' });
    if (!out.ok) expect(out.message).toMatch(/no USD\/ZAR rate/);
  });

  it('defaults to USDC, or to BUREAU_DEFAULT_ASSET when the operator sets it', () => {
    expect(defaultAsset()).toBe('USDC');
    process.env['BUREAU_DEFAULT_ASSET'] = 'zarp';
    expect(defaultAsset()).toBe('ZARP');
    process.env['BUREAU_DEFAULT_ASSET'] = 'DOGE';
    expect(defaultAsset()).toBe('USDC');
  });

  describe('confirming', () => {
    async function open(requestorId: string) {
      gateway(() => ({ body: { ...ZARP_QUOTE, receipt_id: `rcpt_${randomUUID()}` } }));
      const out = await requestTopUp(requestorId, 10, 'ZARP');
      if (!out.ok) throw new Error('open failed');
      return out.receipt.receiptId;
    }

    it('credits exactly the USD value quoted, once, when the gateway confirms what was asked for', async () => {
      const who = `req_${randomUUID()}`;
      const id = await open(who);
      gateway(() => ({ body: { status: 'confirmed', valid: true, asset: 'ZARP', received_units: ZARP_QUOTE.amount_units } }));
      const first = await confirmTopUp(id, who);
      expect(first).toMatchObject({ ok: true, alreadyConfirmed: false });
      expect(centsToUsd(getAccountSummary(who).balanceUsdCents)).toBe(10);
      const again = await confirmTopUp(id, who);
      expect(again).toMatchObject({ ok: true, alreadyConfirmed: true });
      expect(centsToUsd(getAccountSummary(who).balanceUsdCents)).toBe(10); // not 20
    });

    it('credits nothing if the gateway says it was paid in a different token', async () => {
      const who = `req_${randomUUID()}`;
      const id = await open(who);
      gateway(() => ({ body: { status: 'confirmed', valid: true, asset: 'USDC', received_units: ZARP_QUOTE.amount_units } }));
      expect(await confirmTopUp(id, who)).toMatchObject({ ok: false, reason: 'amount_mismatch' });
      expect(getAccountSummary(who).balanceUsdCents).toBe(0);
    });

    it('credits nothing if fewer units arrived than were quoted', async () => {
      const who = `req_${randomUUID()}`;
      const id = await open(who);
      gateway(() => ({ body: { status: 'confirmed', valid: true, asset: 'ZARP', received_units: '1000' } }));
      expect(await confirmTopUp(id, who)).toMatchObject({ ok: false, reason: 'amount_mismatch' });
      expect(getAccountSummary(who).balanceUsdCents).toBe(0);
      // and it can still be confirmed properly later
      gateway(() => ({ body: { status: 'confirmed', valid: true, asset: 'ZARP', received_units: ZARP_QUOTE.amount_units } }));
      expect(await confirmTopUp(id, who)).toMatchObject({ ok: true });
    });

    it('carries the gateway key when verifying', async () => {
      const who = `req_${randomUUID()}`;
      const id = await open(who);
      const fn = gateway(() => ({ body: { status: 'pending', valid: false } }));
      await confirmTopUp(id, who);
      expect(fn.mock.calls[0]![1].headers['x-api-key']).toBe('k');
    });
  });
});

// ── Furnisher payouts ─────────────────────────────────────────────────────────

const ADDRESS = '0x1234567890123456789012345678901234567890';
const NOW = new Date('2026-09-09T00:00:00Z');
const PERIOD = '2026-08';

function contributor(id: string, over: Partial<DataContributor> = {}): DataContributor {
  return {
    id, name: `Furnisher ${id}`, type: 'lending_protocol', apiKeyHash: 'h', permissions: [], queriesUsed: 0, queriesAllowed: 100,
    dataRecordsContributed: 10, createdAt: '2026-01-01T00:00:00Z', status: 'active', payoutAddress: ADDRESS, ...over,
  } as DataContributor;
}
let seq = 0;
const entry = (cid: string, cents: number): AttributionEntry => ({
  id: `attr_${++seq}`, contributorId: cid, reportId: 'r', agentId: 'a', share: 1, amountUsdCents: cents, creditsAccrued: 0, phase: 'cash', createdAt: '2026-08-15T00:00:00Z',
});

describe('furnisher payouts in the furnisher\'s chosen token', () => {
  beforeEach(() => { contributors.clear(); attributions.clear(); });

  const payoutReply = (over: Record<string, unknown> = {}) => (body: any) => ({
    body: { data: { id: `p_${body.external_id}`, status: 'approved', asset: body.asset, amountUnits: '925000000000000000000', fxRate: '18.5', ...over }, deduplicated: false, requires_approval: false },
  });

  it('a furnisher who chose ZARP is paid its USD share in ZARP, and the line says what was sent', async () => {
    setContributor(contributor('c1', { payoutAsset: 'ZARP' })); recordAttribution(entry('c1', 5000));
    const fn = gateway((_u, init) => payoutReply()(JSON.parse(init.body)));
    const run = await settleFurnisherPeriod(PERIOD, NOW);
    const body = sent(fn);
    expect(body).toMatchObject({ asset: 'ZARP', amount_usd: 50 });
    expect(body).not.toHaveProperty('amount_usdc');
    expect(run.ok && run.lines[0]).toMatchObject({ asset: 'ZARP', amountUnits: '925000000000000000000', fxRate: '18.5' });
    expect(run.ok && run.totalPaidUsdCents).toBe(5000); // the ledger is USD whatever was sent
  });

  it('OUSD works the same way, and USDC callers still get the older field', async () => {
    setContributor(contributor('c1', { payoutAsset: 'OUSD' })); setContributor(contributor('c2')); recordAttribution(entry('c1', 100)); recordAttribution(entry('c2', 100));
    const fn = gateway((_u, init) => payoutReply({ amountUnits: '1000000', fxRate: undefined })(JSON.parse(init.body)));
    await settleFurnisherPeriod(PERIOD, NOW);
    const bodies = fn.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies.find((b) => b.payee_id === 'c1')).toMatchObject({ asset: 'OUSD', amount_usd: 1 });
    const usdc = bodies.find((b) => b.payee_id === 'c2');
    expect(usdc).toMatchObject({ asset: 'USDC', amount_usd: 1, amount_usdc: 1 });
  });

  it('uses FURNISHER_PAYOUT_ASSET for furnishers that have not chosen, and USDC if unset', () => {
    expect(payoutAssetFor(contributor('x'))).toBe('USDC');
    process.env['FURNISHER_PAYOUT_ASSET'] = 'OUSD';
    expect(payoutAssetFor(contributor('x'))).toBe('OUSD');
    expect(payoutAssetFor(contributor('x', { payoutAsset: 'ZARP' }))).toBe('ZARP'); // its own choice wins
    process.env['FURNISHER_PAYOUT_ASSET'] = 'nonsense';
    expect(payoutAssetFor(contributor('x'))).toBe('USDC');
  });

  it('does NOT mark entries settled if the gateway recorded the payout in a different token', async () => {
    setContributor(contributor('c1', { payoutAsset: 'ZARP' })); recordAttribution(entry('c1', 5000));
    // an older gateway ignored `asset` and recorded USDC
    gateway((_u, init) => ({ body: { data: { id: 'p_old', status: 'approved' }, deduplicated: false, requires_approval: false } }));
    const run = await settleFurnisherPeriod(PERIOD, NOW);
    expect(run.ok && run.failedCount).toBe(1);
    expect(run.ok && run.lines[0]!.error).toMatch(/recorded the payout in USDC, not ZARP/);
    expect(run.ok && run.totalPaidUsdCents).toBe(0);
    // still owed, so the next run retries once the gateway is fixed
    expect(previewPeriod(PERIOD)[0]!.amountUsdCents).toBe(5000);
  });

  it('a settlement preview shows which token each furnisher will get', () => {
    setContributor(contributor('c1', { payoutAsset: 'ZARP' })); recordAttribution(entry('c1', 100));
    expect(previewPeriod(PERIOD)[0]).toMatchObject({ payoutAsset: 'ZARP' });
  });
});

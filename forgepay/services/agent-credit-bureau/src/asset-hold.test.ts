import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enabledAssets, isAssetEnabled } from './asset-hold';
import { requestTopUp, defaultAsset } from './billing';
import { settleFurnisherPeriod, unsettledEntriesFor } from './furnisher-payouts';
import { contributors, attributions, setContributor, recordAttribution } from './store';
import type { AttributionEntry, DataContributor } from './types';

const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ZARP and OUSD are on hold', () => {
  it('production allows only USDC unless assets are enabled by name; elsewhere all, as before', () => {
    expect(enabledAssets(env({ NODE_ENV: 'production' }))).toEqual(['USDC']);
    expect(enabledAssets(env({ NODE_ENV: 'development' }))).toEqual(['USDC', 'ZARP', 'OUSD']);
    expect(enabledAssets(env({ NODE_ENV: 'production', BUREAU_ENABLED_ASSETS: 'usdc, zarp' }))).toEqual(['USDC', 'ZARP']);
    expect(enabledAssets(env({ NODE_ENV: 'production', BUREAU_ENABLED_ASSETS: 'bogus' }))).toEqual([]);
    expect(isAssetEnabled('ZARP', env({ NODE_ENV: 'production' }))).toBe(false);
  });

  it('the default asset falls back to USDC when the configured default is held', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['BUREAU_DEFAULT_ASSET'] = 'ZARP';
    expect(defaultAsset()).toBe('USDC');
  });

  it('a top-up in a held asset is refused before anything is sent to the gateway', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['STABLECOIN_GATEWAY_URL'] = 'https://gateway.test';
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    for (const a of ['ZARP', 'OUSD'] as const) {
      const r = await requestTopUp('req_1', 10, a);
      expect(r).toMatchObject({ ok: false, reason: 'asset_unavailable' });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a furnisher set to a held asset is not paid in another token: the share stays owed', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['STABLECOIN_GATEWAY_URL'] = 'https://gateway.test';
    contributors.clear(); attributions.clear();
    const c = { id: 'c1', name: 'F', type: 'lending_protocol', apiKeyHash: 'h', permissions: [], queriesUsed: 0, queriesAllowed: 1, dataRecordsContributed: 1,
      createdAt: '2026-01-01T00:00:00Z', status: 'active', payoutAddress: '0x1234567890123456789012345678901234567890', payoutAsset: 'ZARP' } as unknown as DataContributor;
    setContributor(c);
    recordAttribution({ id: 'a1', contributorId: 'c1', reportId: 'r', agentId: 'ag', share: 1, amountUsdCents: 500, creditsAccrued: 0, phase: 'cash', createdAt: '2026-08-15T00:00:00Z' } as AttributionEntry);
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const out = await settleFurnisherPeriod('2026-08', new Date('2026-09-09T00:00:00Z'));
    if (!out.ok) throw new Error('unreachable');
    expect(out.lines[0]!.error).toMatch(/on hold/);
    expect(fetchFn).not.toHaveBeenCalled();                      // nothing was sent, in ZARP or anything else
    expect(unsettledEntriesFor('c1', '2026-08')).toHaveLength(1); // still owed
  });
});

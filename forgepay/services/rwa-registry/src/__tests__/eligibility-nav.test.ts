/**
 * Tokenised assets: nobody holds one without verified eligibility, and
 * nothing is valued on a typed-in or stale price.
 *
 * Regressions guarded: every asset said requiresKyc but nothing checked it;
 * USDY was priced as Ondo's governance token; a failed price refresh stamped
 * the old NAV "updated now".
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../index';
import { rwaAssets } from '../store';
import { eligibilityError } from '../eligibility';
import { navUsable, plausibleNav, refreshAllNAVs } from '../nav';
import type { RWAAsset } from '../types';

const ADMIN = { 'x-api-key': 'test-key' };

function asset(over: Partial<RWAAsset> = {}): RWAAsset {
  const any = [...rwaAssets.values()][0]!;
  return { ...any, requiresKyc: true, requiresAccreditedInvestor: false, supportedJurisdictions: ['all'], ...over };
}

describe('eligibilityError', () => {
  it('fails closed with no record', () => {
    expect(eligibilityError(undefined, asset())).toMatch(/No verified eligibility/);
  });
  it('requires KYC, accreditation and jurisdiction where the asset says so', () => {
    const e = { merchantId: 'm', kycVerified: true, accredited: false, jurisdiction: 'ZA', verifiedBy: 'x', verifiedAt: '' };
    expect(eligibilityError(e, asset())).toBeNull();
    expect(eligibilityError({ ...e, kycVerified: false }, asset())).toMatch(/KYC/);
    expect(eligibilityError(e, asset({ requiresAccreditedInvestor: true }))).toMatch(/accredited/);
    expect(eligibilityError(e, asset({ supportedJurisdictions: ['US'] }))).toMatch(/not offered in ZA/);
  });
});

describe('NAV', () => {
  it('a seed NAV is never usable; a market NAV is, until it is stale', () => {
    expect(navUsable({ navSource: 'seed', navUpdatedAt: null })).toBe(false);
    expect(navUsable({ navSource: 'market', navUpdatedAt: new Date().toISOString() })).toBe(true);
    expect(navUsable({ navSource: 'market', navUpdatedAt: new Date(Date.now() - 48 * 3600_000).toISOString() })).toBe(false);
  });

  it('rejects implausible jumps between market prices', () => {
    expect(plausibleNav(1.08, 1.081)).toBe(true);
    expect(plausibleNav(1.08, 0.72)).toBe(false);
  });

  it('a failed refresh keeps the old timestamp instead of stamping it fresh', async () => {
    const usdy = [...rwaAssets.values()].find((a) => a.symbol === 'USDY')!;
    usdy.navSource = 'market';
    usdy.navUpdatedAt = '2026-01-01T00:00:00.000Z';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    await refreshAllNAVs();
    vi.unstubAllGlobals();
    expect(usdy.navUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('prices USDY from USDY, not from the ONDO governance token', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(String(u)); return { ok: false, status: 503, json: async () => ({}) }; }));
    await refreshAllNAVs();
    vi.unstubAllGlobals();
    expect(urls.some((u) => u.includes('ondo-governance-token'))).toBe(false);
    expect(urls.some((u) => u.includes('ondo-us-dollar-yield'))).toBe(true);
  });
});

describe('POST /v1/positions', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('refuses a merchant with no eligibility record, even with a market price', async () => {
    const a = [...rwaAssets.values()].sort((x, y) => x.minimumInvestmentUsd - y.minimumInvestmentUsd)[0]!;
    a.navSource = 'market'; a.navUpdatedAt = new Date().toISOString();
    const res = await app.inject({
      method: 'POST', url: '/v1/positions', headers: ADMIN,
      payload: { merchantId: 'unverified_merchant', assetId: a.id, units: Math.ceil(a.minimumInvestmentUsd / a.nav) + 1, costBasisUsd: 10_000 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('NotEligible');
  });

  it('refuses to value a position on a seed NAV', async () => {
    const a = [...rwaAssets.values()][1]!;
    a.navSource = 'seed'; a.navUpdatedAt = null;
    const res = await app.inject({
      method: 'POST', url: '/v1/positions', headers: ADMIN,
      payload: { merchantId: 'm', assetId: a.id, units: 1_000_000, costBasisUsd: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('NavUnavailable');
  });

  it('only an admin records eligibility', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/eligibility/m1', headers: ADMIN,
      payload: { kycVerified: true, accredited: false, jurisdiction: 'za', verifiedBy: 'ops' },
    });
    expect(res.json().data.jurisdiction).toBe('ZA');
  });
});

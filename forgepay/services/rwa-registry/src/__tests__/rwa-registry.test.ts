/**
 * Integration tests for the RWA (Real-World Assets) Registry service.
 *
 * Uses Fastify's built-in app.inject() to exercise HTTP routes without
 * binding to a real port. The apiKeyAuth plugin allows any non-empty
 * key in non-production mode, so all non-health requests carry 'x-api-key'.
 *
 * Asset IDs are UUID-based (generated at module-load time in store.ts),
 * so we discover them via GET /v1/assets in beforeAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../index';

// ── Helpers ───────────────────────────────────────────────────────────────────

type FastifyApp = Awaited<ReturnType<typeof buildApp>>;

const AUTH = { 'x-api-key': 'test-key' };
const MERCHANT_ID = 'test_mer_001';

interface AssetRecord {
  id:                   string;
  symbol:               string;
  assetClass:           string;
  currentApyBps:        number;
  minimumInvestmentUsd: number;
  minimumRedemptionUsd: number;
  nav:                  number;
  status:               string;
}

async function makeApp(): Promise<FastifyApp> {
  const app = await buildApp();
  await app.ready();
  return app;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('RWA Registry', () => {
  let app: FastifyApp;
  let assets: AssetRecord[] = [];
  /** First available asset (lowest-minimum investment). */
  let firstAsset: AssetRecord;

  beforeAll(async () => {
    app = await makeApp();

    // Discover the seeded assets (IDs are runtime UUIDs)
    const res = await app.inject({ method: 'GET', url: '/v1/assets', headers: AUTH });
    assets = res.json<{ data: AssetRecord[] }>().data;
    // Pick the asset with the lowest minimum so tests can create cheap positions
    firstAsset = [...assets].sort((a, b) => a.minimumInvestmentUsd - b.minimumInvestmentUsd)[0];
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Health ─────────────────────────────────────────────────────────────────

  it('GET /health returns 200 with service metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; service: string; assetCount: number }>();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('rwa-registry');
    expect(body.assetCount).toBeGreaterThan(0);
  });

  // ── GET /v1/assets ────────────────────────────────────────────────────────

  it('GET /v1/assets returns seeded asset list (USDY, FOBXX, TBILL, etc.)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/assets', headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: AssetRecord[]; total: number }>();
    expect(body.total).toBeGreaterThanOrEqual(6); // 6 seeded assets
    expect(Array.isArray(body.data)).toBe(true);

    const symbols = body.data.map((a) => a.symbol);
    expect(symbols).toContain('USDY');
    expect(symbols).toContain('FOBXX');
    expect(symbols).toContain('TBILL');
  });

  it('GET /v1/assets?assetClass=treasury_bill filters correctly', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/assets?assetClass=treasury_bill',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ assetClass: string }> }>();
    expect(body.data.length).toBeGreaterThan(0);
    body.data.forEach((a) => expect(a.assetClass).toBe('treasury_bill'));
  });

  it('GET /v1/assets?minApy=500 returns only high-yield assets', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/assets?minApy=500',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ currentApyBps: number }> }>();
    expect(body.data.length).toBeGreaterThan(0);
    body.data.forEach((a) => expect(a.currentApyBps).toBeGreaterThanOrEqual(500));
  });

  // ── GET /v1/assets/compare ────────────────────────────────────────────────

  it('GET /v1/assets/compare returns all assets sorted by APY', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/assets/compare',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    // compare endpoint returns { apyBps, symbol, ... } via getYieldComparison()
    const body = res.json<{ data: Array<{ apyBps: number; symbol: string }> }>();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    // Verify descending APY sort (compare items use 'apyBps', not 'currentApyBps')
    for (let i = 1; i < body.data.length; i++) {
      expect(body.data[i - 1].apyBps).toBeGreaterThanOrEqual(
        body.data[i].apyBps
      );
    }
  });

  // ── GET /v1/assets/:id ────────────────────────────────────────────────────

  it('GET /v1/assets/:id retrieves a single asset', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/v1/assets/${firstAsset.id}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: AssetRecord }>();
    expect(body.data.id).toBe(firstAsset.id);
    expect(body.data.symbol).toBe(firstAsset.symbol);
  });

  it('GET /v1/assets/:id returns 404 for unknown asset', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/assets/nonexistent-asset-uuid',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('NotFound');
  });

  // ── POST /v1/positions ────────────────────────────────────────────────────

  it('POST /v1/positions opens a new position (merchantId, assetId, units, costBasisUsd)', async () => {
    // Use enough units so (units * nav) >= minimumInvestmentUsd
    const units         = Math.ceil(firstAsset.minimumInvestmentUsd / firstAsset.nav) + 10;
    const costBasisUsd  = units * firstAsset.nav;

    const res = await app.inject({
      method:  'POST',
      url:     '/v1/positions',
      headers: AUTH,
      payload: {
        merchantId:   MERCHANT_ID,
        assetId:      firstAsset.id,
        units,
        costBasisUsd,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data['merchantId']).toBe(MERCHANT_ID);
    expect(body.data['assetId']).toBe(firstAsset.id);
    expect(body.data['units']).toBe(units);
    expect(typeof body.data['id']).toBe('string');
    expect(typeof body.data['currentValueUsd']).toBe('number');
  });

  it('POST /v1/positions with missing fields returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/positions',
      headers: AUTH,
      payload: {
        merchantId: MERCHANT_ID,
        // missing assetId, units, costBasisUsd
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('ValidationError');
  });

  it('POST /v1/positions returns 400 when units is below minimum investment', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/positions',
      headers: AUTH,
      payload: {
        merchantId:  MERCHANT_ID,
        assetId:     firstAsset.id,
        units:       0.001,        // trivially small — way below minimum
        costBasisUsd: 0.001,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/positions returns 404 for unknown assetId', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/positions',
      headers: AUTH,
      payload: {
        merchantId:   MERCHANT_ID,
        assetId:      'does-not-exist',
        units:        1000,
        costBasisUsd: 1000,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── GET /v1/positions ─────────────────────────────────────────────────────

  it('GET /v1/positions?merchantId=test_mer_001 returns merchant positions', async () => {
    // Ensure at least one position exists for this merchant (previous test created one)
    const res = await app.inject({
      method:  'GET',
      url:     `/v1/positions?merchantId=${MERCHANT_ID}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ merchantId: string }>; total: number }>();
    expect(body.total).toBeGreaterThan(0);
    body.data.forEach((p) => expect(p.merchantId).toBe(MERCHANT_ID));
  });

  it('GET /v1/positions without merchantId returns 400', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/positions',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /v1/positions/:id ─────────────────────────────────────────────────

  it('GET /v1/positions/:id retrieves single position', async () => {
    // Create a fresh position
    const units        = Math.ceil(firstAsset.minimumInvestmentUsd / firstAsset.nav) + 5;
    const costBasisUsd = units * firstAsset.nav;

    const createRes = await app.inject({
      method:  'POST',
      url:     '/v1/positions',
      headers: AUTH,
      payload: {
        merchantId:   MERCHANT_ID,
        assetId:      firstAsset.id,
        units,
        costBasisUsd,
      },
    });
    const positionId = createRes.json<{ data: { id: string } }>().data.id;

    const res = await app.inject({
      method:  'GET',
      url:     `/v1/positions/${positionId}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { id: string } }>();
    expect(body.data.id).toBe(positionId);
  });

  it('GET /v1/positions/:id returns 404 for unknown position', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/positions/nonexistent-position-uuid',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });

  // ── PUT /v1/positions/:id/update-value ────────────────────────────────────

  it('PUT /v1/positions/:id/update-value triggers NAV refresh on position', async () => {
    const units        = Math.ceil(firstAsset.minimumInvestmentUsd / firstAsset.nav) + 5;
    const costBasisUsd = units * firstAsset.nav;

    const createRes = await app.inject({
      method:  'POST',
      url:     '/v1/positions',
      headers: AUTH,
      payload: {
        merchantId:   MERCHANT_ID,
        assetId:      firstAsset.id,
        units,
        costBasisUsd,
      },
    });
    const positionId = createRes.json<{ data: { id: string } }>().data.id;

    const res = await app.inject({
      method:  'PUT',
      url:     `/v1/positions/${positionId}/update-value`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { id: string; currentValueUsd: number; lastUpdatedAt: string } }>();
    expect(body.data.id).toBe(positionId);
    expect(typeof body.data.currentValueUsd).toBe('number');
    expect(typeof body.data.lastUpdatedAt).toBe('string');
  });

  // ── GET /v1/income ────────────────────────────────────────────────────────

  it('GET /v1/income?merchantId=test_mer_001 returns income history', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/v1/income?merchantId=${MERCHANT_ID}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(Array.isArray(body.data)).toBe(true);
    // May be empty if no income has been distributed yet, but the shape should be correct
    expect(typeof body.total).toBe('number');
  });

  it('GET /v1/income without merchantId returns 400', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/income',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /v1/income/tax-summary ────────────────────────────────────────────

  it('GET /v1/income/tax-summary?merchantId=test_mer_001 returns tax summary', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/v1/income/tax-summary?merchantId=${MERCHANT_ID}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      merchantId:         string;
      year:               string;
      taxLiability:       Record<string, number>;
      totalTaxableIncome: number;
      distributionCount:  number;
    }>();
    expect(body.merchantId).toBe(MERCHANT_ID);
    expect(typeof body.totalTaxableIncome).toBe('number');
    expect(typeof body.distributionCount).toBe('number');
  });

  it('GET /v1/income/tax-summary without merchantId returns 400', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/income/tax-summary',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  // ── POST /v1/redemptions ──────────────────────────────────────────────────

  it('POST /v1/redemptions creates a redemption request', async () => {
    // Calculate units such that we can redeem at least minimumRedemptionUsd worth.
    // We create a large-enough position, then redeem exactly the minimum redemption amount.
    const minRedeemUnits = Math.ceil(firstAsset.minimumRedemptionUsd / firstAsset.nav) + 5;
    // Total position must be >= minimumInvestmentUsd AND have enough units to redeem
    const totalUnits = Math.max(
      Math.ceil(firstAsset.minimumInvestmentUsd / firstAsset.nav) + 5,
      minRedeemUnits * 2,
    );
    const costBasisUsd = totalUnits * firstAsset.nav;

    const createRes = await app.inject({
      method:  'POST',
      url:     '/v1/positions',
      headers: AUTH,
      payload: {
        merchantId:   MERCHANT_ID,
        assetId:      firstAsset.id,
        units:        totalUnits,
        costBasisUsd,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const position = createRes.json<{ data: { id: string; assetId: string; units: number } }>().data;

    const res = await app.inject({
      method:  'POST',
      url:     '/v1/redemptions',
      headers: AUTH,
      payload: {
        merchantId:  MERCHANT_ID,
        assetId:     position.assetId,
        positionId:  position.id,
        units:       minRedeemUnits,
        speed:       firstAsset.symbol === 'OUSG' ? 'instant' : 'next_day',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{
      data: {
        id:          string;
        merchantId:  string;
        positionId:  string;
        status:      string;
        requestedUnits: number;
      };
    }>();
    expect(body.data.merchantId).toBe(MERCHANT_ID);
    expect(body.data.positionId).toBe(position.id);
    expect(body.data.status).toBe('pending');
    expect(body.data.requestedUnits).toBe(minRedeemUnits);
    expect(typeof body.data.id).toBe('string');
  });

  it('POST /v1/redemptions with missing required fields returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/redemptions',
      headers: AUTH,
      payload: {
        merchantId: MERCHANT_ID,
        // missing assetId, positionId, units
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /v1/redemptions ───────────────────────────────────────────────────

  it('GET /v1/redemptions?merchantId=test_mer_001 lists redemptions', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/v1/redemptions?merchantId=${MERCHANT_ID}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  it('GET /v1/redemptions without merchantId returns 400', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/redemptions',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /v1/redemptions/:id ───────────────────────────────────────────────

  it('GET /v1/redemptions/:id retrieves a single redemption', async () => {
    // Create a position large enough to redeem the minimum redemption amount
    const minRedeemUnits = Math.ceil(firstAsset.minimumRedemptionUsd / firstAsset.nav) + 5;
    const totalUnits = Math.max(
      Math.ceil(firstAsset.minimumInvestmentUsd / firstAsset.nav) + 5,
      minRedeemUnits * 2,
    );
    const costBasisUsd = totalUnits * firstAsset.nav;

    const posRes = await app.inject({
      method:  'POST',
      url:     '/v1/positions',
      headers: AUTH,
      payload: {
        merchantId:   MERCHANT_ID,
        assetId:      firstAsset.id,
        units:        totalUnits,
        costBasisUsd,
      },
    });
    const position = posRes.json<{ data: { id: string; assetId: string } }>().data;

    const redRes = await app.inject({
      method:  'POST',
      url:     '/v1/redemptions',
      headers: AUTH,
      payload: {
        merchantId:  MERCHANT_ID,
        assetId:     position.assetId,
        positionId:  position.id,
        units:       minRedeemUnits,
      },
    });
    expect(redRes.statusCode).toBe(201);
    const redemptionId = redRes.json<{ data: { id: string } }>().data.id;

    const res = await app.inject({
      method:  'GET',
      url:     `/v1/redemptions/${redemptionId}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { id: string } }>();
    expect(body.data.id).toBe(redemptionId);
  });

  it('GET /v1/redemptions/:id returns 404 for unknown redemption', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/redemptions/nonexistent-redemption-uuid',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });

  // ── POST /v1/redemptions/:id/cancel ──────────────────────────────────────

  it('POST /v1/redemptions/:id/cancel cancels a pending redemption', async () => {
    // Create a position large enough to redeem above the minimum redemption amount
    const minRedeemUnits = Math.ceil(firstAsset.minimumRedemptionUsd / firstAsset.nav) + 5;
    const totalUnits = Math.max(
      Math.ceil(firstAsset.minimumInvestmentUsd / firstAsset.nav) + 5,
      minRedeemUnits * 2,
    );
    const costBasisUsd = totalUnits * firstAsset.nav;

    const posRes = await app.inject({
      method:  'POST',
      url:     '/v1/positions',
      headers: AUTH,
      payload: {
        merchantId:   MERCHANT_ID,
        assetId:      firstAsset.id,
        units:        totalUnits,
        costBasisUsd,
      },
    });
    const position = posRes.json<{ data: { id: string; assetId: string } }>().data;

    const redRes = await app.inject({
      method:  'POST',
      url:     '/v1/redemptions',
      headers: AUTH,
      payload: {
        merchantId:  MERCHANT_ID,
        assetId:     position.assetId,
        positionId:  position.id,
        units:       minRedeemUnits,
      },
    });
    expect(redRes.statusCode).toBe(201);
    const redemptionId = redRes.json<{ data: { id: string } }>().data.id;

    const cancelRes = await app.inject({
      method:  'POST',
      url:     `/v1/redemptions/${redemptionId}/cancel`,
      headers: AUTH,
    });
    expect(cancelRes.statusCode).toBe(200);
    const body = cancelRes.json<{ success: boolean; message: string }>();
    expect(body.success).toBe(true);
  });

  // ── POST /v1/nav/refresh ──────────────────────────────────────────────────

  it('POST /v1/nav/refresh triggers NAV refresh for all assets', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/nav/refresh',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; message: string; assetCount: number }>();
    expect(body.success).toBe(true);
    expect(body.assetCount).toBeGreaterThan(0);
  });

  // ── Auth enforcement ─────────────────────────────────────────────────────

  it('Requests without X-Api-Key return 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/assets' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /health does not require auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

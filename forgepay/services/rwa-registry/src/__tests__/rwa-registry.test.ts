/**
 * Integration tests for the RWA Registry service.
 *
 * Uses Fastify's built-in app.inject() to exercise HTTP routes
 * without binding to a real port.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../index';

type FastifyApp = Awaited<ReturnType<typeof buildApp>>;

const AUTH = { 'x-api-key': 'test-key', 'Content-Type': 'application/json' };

async function makeApp(): Promise<FastifyApp> {
  const app = await buildApp();
  await app.ready();
  return app;
}

async function openPosition(app: FastifyApp, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/positions',
    headers: AUTH,
    payload: {
      merchantId: 'mer_test_001',
      assetId: 'ondo-usdy',
      amountUsdc: 10000,
      ...overrides,
    },
  });
}

describe('RWA Registry', () => {
  let app: FastifyApp;

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Health ─────────────────────────────────────────────────────────────────

  it('GET /health returns 200 with service metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; service: string }>();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('rwa-registry');
  });

  // ── GET /v1/assets ────────────────────────────────────────────────────────

  it('GET /v1/assets returns list of available assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/assets', headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.total).toBeGreaterThan(0);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /v1/assets?assetClass=treasury_bill returns filtered assets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/assets?assetClass=treasury_bill',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ assetClass: string }> }>();
    body.data.forEach((a) => expect(a.assetClass).toBe('treasury_bill'));
  });

  it('GET /v1/assets?minApyBps=400 returns only high-yield assets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/assets?minApyBps=400',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ apyBps: number }> }>();
    body.data.forEach((a) => expect(a.apyBps).toBeGreaterThanOrEqual(400));
  });

  // ── GET /v1/assets/:id ────────────────────────────────────────────────────

  it('GET /v1/assets/:id returns a specific asset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/assets/ondo-usdy',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { id: string; ticker: string } }>();
    expect(body.data.id).toBe('ondo-usdy');
    expect(body.data.ticker).toBe('USDY');
  });

  it('GET /v1/assets/:id returns 404 for unknown asset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/assets/nonexistent-asset',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });

  // ── GET /v1/assets/compare ────────────────────────────────────────────────

  it('GET /v1/assets/compare returns side-by-side comparison', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/assets/compare',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[] }>();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  // ── POST /v1/positions ────────────────────────────────────────────────────

  it('POST /v1/positions opens a new position', async () => {
    const res = await openPosition(app);
    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data['merchantId']).toBe('mer_test_001');
    expect(body.data['assetId']).toBe('ondo-usdy');
    expect(body.data['status']).toBe('active');
    expect(typeof body.data['id']).toBe('string');
    expect(typeof body.data['units']).toBe('number');
    expect((body.data['units'] as number)).toBeGreaterThan(0);
  });

  it('POST /v1/positions returns 400 for unknown asset', async () => {
    const res = await openPosition(app, { assetId: 'nonexistent-asset' });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/positions returns 400 when amountUsdc is below minimum', async () => {
    const res = await openPosition(app, { amountUsdc: 1 });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /v1/positions ─────────────────────────────────────────────────────

  it('GET /v1/positions?merchantId=x returns positions for merchant', async () => {
    await openPosition(app, { merchantId: 'mer_filter_test' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/positions?merchantId=mer_filter_test',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ merchantId: string }> }>();
    expect(body.data.length).toBeGreaterThan(0);
    body.data.forEach((p) => expect(p.merchantId).toBe('mer_filter_test'));
  });

  // ── GET /v1/positions/:id ─────────────────────────────────────────────────

  it('GET /v1/positions/:id returns position detail', async () => {
    const createRes = await openPosition(app);
    const positionId = createRes.json<{ data: { id: string } }>().data.id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/positions/${positionId}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { id: string } }>();
    expect(body.data.id).toBe(positionId);
  });

  it('GET /v1/positions/:id returns 404 for unknown position', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/positions/nonexistent-position',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });

  // ── GET /v1/income ────────────────────────────────────────────────────────

  it('GET /v1/income?merchantId=x returns income history', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/income?merchantId=mer_test_001',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[] }>();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /v1/income returns 400 when merchantId is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/income',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /v1/tax-summary ───────────────────────────────────────────────────

  it('GET /v1/tax-summary?merchantId=x returns tax summary', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tax-summary?merchantId=mer_test_001',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data).toBeDefined();
    expect(typeof body.data['ordinaryIncome']).toBe('number');
    expect(typeof body.data['qualifiedDividend']).toBe('number');
  });

  // ── POST /v1/redemptions ──────────────────────────────────────────────────

  it('POST /v1/redemptions creates a redemption request', async () => {
    const createRes = await openPosition(app, { merchantId: 'mer_redeem_test' });
    const position = createRes.json<{ data: { id: string; units: number } }>().data;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/redemptions',
      headers: AUTH,
      payload: {
        positionId: position.id,
        units: Math.floor(position.units / 2),
        merchantId: 'mer_redeem_test',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: { status: string; positionId: string } }>();
    expect(body.data.status).toBe('pending');
    expect(body.data.positionId).toBe(position.id);
  });

  it('POST /v1/redemptions returns 400 for unknown position', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/redemptions',
      headers: AUTH,
      payload: {
        positionId: 'nonexistent-position',
        units: 100,
        merchantId: 'mer_test',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── POST /v1/nav/refresh ──────────────────────────────────────────────────

  it('POST /v1/nav/refresh triggers NAV refresh and returns updated counts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/nav/refresh',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { assetsUpdated: number } }>();
    expect(typeof body.data.assetsUpdated).toBe('number');
  });

  // ── Auth enforcement ─────────────────────────────────────────────────────

  it('Requests without X-Api-Key header return 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/assets' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /health does not require auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

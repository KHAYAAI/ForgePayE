/**
 * Tests for internal settlement routes (wire + stablecoin).
 * These routes are called service-to-service by enterprise-treasury.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { buildInternalRoutes, settlementStore } from '../routes/internal';

let app: ReturnType<typeof Fastify>;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(buildInternalRoutes);
  await app.ready();
  settlementStore.clear();
});

afterAll(async () => {
  await app.close();
});

const HEADERS = {
  'Content-Type': 'application/json',
  'x-source': 'enterprise-treasury',
};

describe('POST /v1/transfers/wire', () => {
  it('creates a wire settlement and returns transferId', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/v1/transfers/wire',
      headers: HEADERS,
      payload: {
        from: 'HQ',
        to: 'EMEA',
        amountUsd: 200_000,
        currency: 'USD',
        reference: 'NET-HQ-EMEA-2026-05-16',
        invoiceRefs: ['INV-001', 'INV-002'],
      },
    });

    expect(resp.statusCode).toBe(201);
    const body = resp.json();
    expect(body.transferId).toBeDefined();
    expect(body.status).toBe('submitted');
    expect(body.swiftRef).toMatch(/^UETR-/);
    expect(body.reference).toBe('NET-HQ-EMEA-2026-05-16');
  });

  it('returns 400 for missing required fields', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/v1/transfers/wire',
      headers: HEADERS,
      payload: { from: 'HQ' }, // missing to, amountUsd, reference
    });
    expect(resp.statusCode).toBe(400);
  });

  it('returns 401 for missing x-source header', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/v1/transfers/wire',
      headers: { 'Content-Type': 'application/json' },
      payload: { from: 'HQ', to: 'EMEA', amountUsd: 100, currency: 'USD', reference: 'R1' },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('returns 401 for unrecognized x-source', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/v1/transfers/wire',
      headers: { 'Content-Type': 'application/json', 'x-source': 'malicious-service' },
      payload: { from: 'HQ', to: 'EMEA', amountUsd: 100, currency: 'USD', reference: 'R1' },
    });
    expect(resp.statusCode).toBe(401);
  });
});

describe('POST /v1/transfers/stablecoin', () => {
  it('creates a stablecoin settlement and returns txHash', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/v1/transfers/stablecoin',
      headers: HEADERS,
      payload: {
        from: 'HQ',
        to: 'APAC',
        amountUsd: 1_500_000,
        currency: 'USDC',
        reference: 'NET-HQ-APAC-2026-05-16',
        invoiceRefs: ['INV-100'],
      },
    });

    expect(resp.statusCode).toBe(201);
    const body = resp.json();
    expect(body.transferId).toBeDefined();
    expect(body.status).toBe('submitted');
    expect(body.txHash).toMatch(/^0x/);
  });

  it('returns 400 for negative amountUsd', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/v1/transfers/stablecoin',
      headers: HEADERS,
      payload: { from: 'HQ', to: 'EMEA', amountUsd: -1, currency: 'USDC', reference: 'R1' },
    });
    expect(resp.statusCode).toBe(400);
  });
});

describe('GET /v1/transfers/internal/:id', () => {
  it('retrieves a settlement by id', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/transfers/wire',
      headers: HEADERS,
      payload: { from: 'HQ', to: 'LATAM', amountUsd: 50_000, currency: 'USD', reference: 'REF-1' },
    });
    const { transferId } = create.json() as { transferId: string };

    const resp = await app.inject({
      method: 'GET',
      url: `/v1/transfers/internal/${transferId}`,
      headers: HEADERS,
    });

    expect(resp.statusCode).toBe(200);
    const body = resp.json();
    expect(body.data.transferId).toBe(transferId);
    expect(body.data.from).toBe('HQ');
    expect(body.data.method).toBe('wire');
  });

  it('returns 404 for unknown id', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/v1/transfers/internal/does-not-exist',
      headers: HEADERS,
    });
    expect(resp.statusCode).toBe(404);
  });
});

describe('GET /v1/transfers/internal', () => {
  it('lists all settlements', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/v1/transfers/internal',
      headers: HEADERS,
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(0);
  });
});

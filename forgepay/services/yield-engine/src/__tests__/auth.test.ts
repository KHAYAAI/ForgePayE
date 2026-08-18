/**
 * Auth regression tests for yield-engine.
 *
 * Covers the fix for two bugs found in review:
 *  1. The global JWT preHandler verified the token but swallowed any
 *     verification failure, so a missing/invalid token never actually
 *     blocked a request.
 *  2. getMerchantId() (duplicated across positions.ts, sweep.ts, yields.ts,
 *     and index.ts's /api/v1/portfolio) fell back unconditionally to the
 *     client-supplied `x-merchant-id` header, letting any caller act as any
 *     merchant — including scheduling withdrawals on positions they don't own.
 *
 * These tests assert:
 *  - Requests with no token, or an invalid token, are rejected with 401
 *    before reaching a handler.
 *  - A valid JWT for merchant A cannot read or mutate merchant B's
 *    positions/sweep config/withdrawals via a spoofed `x-merchant-id`
 *    header — merchant identity always comes from the token, never the
 *    header.
 *  - Public routes (health probes, vault catalogue, /yields/apys) remain
 *    reachable without a token.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../index';
import { positionsStore, sweepConfigStore, txStore } from '../store';
import type { YieldPosition } from '../types';

let app: FastifyInstance;

function tokenFor(merchantId: string): string {
  return app.jwt.sign({ merchantId });
}

function seedPosition(id: string, merchantId: string): YieldPosition {
  const now = new Date().toISOString();
  const position: YieldPosition = {
    id,
    merchantId,
    vaultId: 'aave-v3-usdc-ethereum',
    principal: 5000,
    shares: 5000,
    currentValue: 5000,
    unrealizedYield: 0,
    realizedYield: 0,
    depositedAt: now,
    lastUpdatedAt: now,
    status: 'active',
  };
  positionsStore.set(id, position);
  return position;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  positionsStore.clear();
  sweepConfigStore.clear();
  txStore.clear();
});

describe('unauthenticated / invalid token → 401', () => {
  it('rejects GET /api/v1/positions with no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/positions' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects GET /api/v1/positions with a malformed Bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/positions',
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects GET /api/v1/positions when only x-merchant-id is supplied (no token at all)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/positions',
      headers: { 'x-merchant-id': 'merchant-a' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects PUT /api/v1/sweep/config with no token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/sweep/config',
      payload: {
        enabled: true,
        idleThresholdUsd: 1000,
        targetVaultId: 'aave-v3-usdc-ethereum',
        keepReserveUsd: 500,
        autoCompound: false,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects DELETE /api/v1/positions/:id (withdrawal) with no token', async () => {
    seedPosition('pos-1', 'merchant-a');
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/positions/pos-1' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects GET /api/v1/portfolio with an expired/garbage token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/portfolio',
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.garbage.garbage' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('public routes remain reachable without a token', () => {
  it('GET /healthz', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/vaults', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/vaults' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/yields/apys', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/yields/apys' });
    expect(res.statusCode).toBe(200);
  });
});

describe('merchant identity comes from the JWT, never x-merchant-id', () => {
  it('a valid token for merchant A cannot list merchant B positions via a spoofed header', async () => {
    seedPosition('pos-a', 'merchant-a');
    seedPosition('pos-b', 'merchant-b');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/positions',
      headers: {
        authorization: `Bearer ${tokenFor('merchant-a')}`,
        'x-merchant-id': 'merchant-b',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('pos-a');
  });

  it('a valid token for merchant A gets 403 reading merchant B\'s position by id, even with a spoofed header', async () => {
    seedPosition('pos-b', 'merchant-b');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/positions/pos-b',
      headers: {
        authorization: `Bearer ${tokenFor('merchant-a')}`,
        'x-merchant-id': 'merchant-b',
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it('a valid token for merchant A cannot schedule a withdrawal on merchant B\'s position via a spoofed header', async () => {
    seedPosition('pos-b', 'merchant-b');

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/positions/pos-b',
      headers: {
        authorization: `Bearer ${tokenFor('merchant-a')}`,
        'x-merchant-id': 'merchant-b',
      },
    });

    expect(res.statusCode).toBe(403);
    // The position must be untouched — no withdrawal transaction created.
    const txs = [...txStore.values()].filter((t) => t.positionId === 'pos-b');
    expect(txs).toHaveLength(0);
  });

  it('a valid token for merchant A cannot read merchant B\'s sweep config via a spoofed header', async () => {
    sweepConfigStore.set('merchant-b', {
      merchantId: 'merchant-b',
      enabled: true,
      idleThresholdUsd: 2500,
      targetVaultId: 'aave-v3-usdc-ethereum',
      keepReserveUsd: 1000,
      autoCompound: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sweep/config',
      headers: {
        authorization: `Bearer ${tokenFor('merchant-a')}`,
        'x-merchant-id': 'merchant-b',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // merchant-a has no config, so this must be the "not configured" default,
    // never merchant-b's real (idleThresholdUsd: 2500) config.
    expect(body.merchantId).toBe('merchant-a');
    expect(body.configured).toBe(false);
  });

  it('a valid token for merchant A writes sweep config under merchant A, never merchant B, despite a spoofed header', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/sweep/config',
      headers: {
        authorization: `Bearer ${tokenFor('merchant-a')}`,
        'x-merchant-id': 'merchant-b',
      },
      payload: {
        enabled: true,
        idleThresholdUsd: 1000,
        targetVaultId: 'aave-v3-usdc-ethereum',
        keepReserveUsd: 500,
        autoCompound: false,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sweepConfigStore.has('merchant-a')).toBe(true);
    expect(sweepConfigStore.has('merchant-b')).toBe(false);
  });

  it('legitimate same-merchant access still works end to end', async () => {
    seedPosition('pos-a', 'merchant-a');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/positions/pos-a',
      headers: { authorization: `Bearer ${tokenFor('merchant-a')}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('pos-a');
  });
});

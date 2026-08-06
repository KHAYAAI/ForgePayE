/**
 * FORGE Custody test suite — policy engine, HMAC auth, signing lifecycle,
 * and audit trail. Runs fully in-memory (no Postgres required).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { computeSignature, __resetReplayCache } from '../src/auth';
import { evaluatePolicies } from '../src/policy';
import {
  auditLog,
  createKey,
  createPolicy,
  createWorkspace,
  issueApiKey,
  resetStore,
  saveSigningRequest,
  newId,
} from '../src/store';
import type { SigningRequest } from '../src/types';

let app: FastifyInstance;
let workspaceId: string;
let rawKey: string;
let keyId: string;

function signedHeaders(method: string, path: string, body: unknown): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = body ? JSON.stringify(body) : '';
  return {
    'x-api-key': rawKey,
    'x-timestamp': timestamp,
    'x-signature': computeSignature(rawKey, method, path, timestamp, payload),
    'content-type': 'application/json',
  };
}

function baseTx(overrides: Partial<SigningRequest['transaction']> = {}) {
  return { to: '0xwhitelisted00000000000000000000000000000001', value: '1000000000000000000', ...overrides };
}

beforeEach(async () => {
  resetStore();
  __resetReplayCache();
  const ws = createWorkspace('Test Bank', 'bank');
  workspaceId = ws.id;
  rawKey = issueApiKey(ws.id, 'test').rawKey;
  keyId = createKey({
    workspaceId,
    blockchain: 'ethereum',
    publicKey: '0xpub',
    address: '0xcustodyaddr',
    totalShares: 7,
    threshold: 4,
    shareHolders: [],
    vaultPath: 'secret/forge-custody/test',
  }).id;
  app = await buildApp();
});

describe('policy engine', () => {
  it('rejects destinations not on the whitelist', async () => {
    createPolicy(workspaceId, 'wl', { whitelist: ['0xWHITELISTED00000000000000000000000000000001'] });
    const decision = await evaluatePolicies({
      workspaceId, keyId, blockchain: 'ethereum', amountUsd: 10,
      transaction: baseTx({ to: '0xevil' }), metadata: {},
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe('DESTINATION_NOT_WHITELISTED');
  });

  it('is case-insensitive for whitelisted destinations', async () => {
    createPolicy(workspaceId, 'wl', { whitelist: ['0xWHITELISTED00000000000000000000000000000001'] });
    const decision = await evaluatePolicies({
      workspaceId, keyId, blockchain: 'ethereum', amountUsd: 10,
      transaction: baseTx(), metadata: {},
    });
    expect(decision.allowed).toBe(true);
  });

  it('enforces the aggregate daily limit', async () => {
    createPolicy(workspaceId, 'limit', { dailyLimitUsd: 100 });
    // Seed an existing request consuming 80 of the 100 limit.
    const existing: SigningRequest = {
      id: newId('sr'), workspaceId, customerId: 'c', keyId, blockchain: 'ethereum',
      transaction: baseTx(), metadata: {}, amountUsd: 80, status: 'confirmed',
      reasonCode: null, approvalsRequired: 0, approverRoles: [], signature: null,
      txHash: null, blockNumber: null, confirmationTime: null, error: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    saveSigningRequest(existing);

    const over = await evaluatePolicies({
      workspaceId, keyId, blockchain: 'ethereum', amountUsd: 30,
      transaction: baseTx(), metadata: {},
    });
    expect(over.allowed).toBe(false);
    expect(over.reasonCode).toBe('DAILY_LIMIT_EXCEEDED');

    const under = await evaluatePolicies({
      workspaceId, keyId, blockchain: 'ethereum', amountUsd: 20,
      transaction: baseTx(), metadata: {},
    });
    expect(under.allowed).toBe(true);
  });

  it('rejects outside the configured time window', async () => {
    const hour = new Date().getUTCHours();
    createPolicy(workspaceId, 'window', {
      timeWindow: { days: [0, 1, 2, 3, 4, 5, 6], startHour: (hour + 2) % 24, endHour: (hour + 3) % 24 || 24 },
    });
    const decision = await evaluatePolicies({
      workspaceId, keyId, blockchain: 'ethereum', amountUsd: 10,
      transaction: baseTx(), metadata: {},
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe('OUTSIDE_TIME_WINDOW');
  });

  it('rejects chains not allowed by policy', async () => {
    createPolicy(workspaceId, 'chains', { allowedChains: ['polygon'] });
    const decision = await evaluatePolicies({
      workspaceId, keyId, blockchain: 'ethereum', amountUsd: 10,
      transaction: baseTx(), metadata: {},
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe('CHAIN_NOT_ALLOWED');
  });

  it('gates large amounts behind the approval threshold without rejecting', async () => {
    createPolicy(workspaceId, 'approvals', {
      approvalThreshold: { amountUsd: 10_000_000, approvalsRequired: 2, roles: ['CFO', 'CEO'] },
    });
    const decision = await evaluatePolicies({
      workspaceId, keyId, blockchain: 'ethereum', amountUsd: 12_000_000,
      transaction: baseTx(), metadata: {},
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.approvalsRequired).toBe(2);
    expect(decision.approverRoles).toEqual(['CFO', 'CEO']);
  });
});

describe('HMAC authentication', () => {
  it('rejects requests with no credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/policies' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a bad signature', async () => {
    const headers = signedHeaders('GET', '/api/v1/policies', undefined);
    headers['x-signature'] = 'f'.repeat(64);
    const res = await app.inject({ method: 'GET', url: '/api/v1/policies', headers });
    expect(res.statusCode).toBe(401);
    expect(res.json().reason).toBe('bad_signature');
  });

  it('rejects a stale timestamp', async () => {
    const stale = (Math.floor(Date.now() / 1000) - 3600).toString();
    const headers = {
      'x-api-key': rawKey,
      'x-timestamp': stale,
      'x-signature': computeSignature(rawKey, 'GET', '/api/v1/policies', stale, ''),
    };
    const res = await app.inject({ method: 'GET', url: '/api/v1/policies', headers });
    expect(res.statusCode).toBe(401);
    expect(res.json().reason).toBe('timestamp_out_of_window');
  });

  it('accepts a correctly signed request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/policies',
      headers: signedHeaders('GET', '/api/v1/policies', undefined),
    });
    expect(res.statusCode).toBe(200);
  });

  // A fresh timestamp bounds how long a captured request stays usable; it does
  // not stop the same request being submitted twice inside that window. These
  // cover the actual replay case — previously untested, and exploitable for a
  // full 5 minutes against endpoints that create policies and approve signings.
  it('rejects a replayed signature inside the timestamp window', async () => {
    const headers = signedHeaders('GET', '/api/v1/policies', undefined);

    const first = await app.inject({ method: 'GET', url: '/api/v1/policies', headers });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({ method: 'GET', url: '/api/v1/policies', headers });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().reason).toBe('replayed_signature');
  });

  it('does not let a replayed state-changing request execute twice', async () => {
    const body = { name: 'Replay probe', rules: { dailyLimitUsd: 1000 } };
    const headers = signedHeaders('POST', '/api/v1/policies', body);

    const first = await app.inject({ method: 'POST', url: '/api/v1/policies', headers, payload: body });
    expect(first.statusCode).toBe(201);

    const replay = await app.inject({ method: 'POST', url: '/api/v1/policies', headers, payload: body });
    expect(replay.statusCode).toBe(401);

    // Exactly one policy was created, not two.
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/policies',
      headers: signedHeaders('GET', '/api/v1/policies', undefined),
    });
    expect(list.json().filter((p: { name: string }) => p.name === 'Replay probe')).toHaveLength(1);
  });

  it('still accepts distinct requests signed in the same second', async () => {
    const a = { name: 'Policy A', rules: { dailyLimitUsd: 1000 } };
    const b = { name: 'Policy B', rules: { dailyLimitUsd: 2000 } };

    const resA = await app.inject({
      method: 'POST', url: '/api/v1/policies',
      headers: signedHeaders('POST', '/api/v1/policies', a), payload: a,
    });
    const resB = await app.inject({
      method: 'POST', url: '/api/v1/policies',
      headers: signedHeaders('POST', '/api/v1/policies', b), payload: b,
    });

    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);
  });

  it('does not let a forged signature evict a legitimate one from the replay cache', async () => {
    const headers = signedHeaders('GET', '/api/v1/policies', undefined);

    const forged = { ...headers, 'x-signature': 'f'.repeat(64) };
    const bad = await app.inject({ method: 'GET', url: '/api/v1/policies', headers: forged });
    expect(bad.json().reason).toBe('bad_signature');

    // The genuine request with the same timestamp must still succeed.
    const good = await app.inject({ method: 'GET', url: '/api/v1/policies', headers });
    expect(good.statusCode).toBe(200);
  });
});

describe('signing lifecycle', () => {
  it('signs, broadcasts, and confirms a policy-clean request (DevSigner)', async () => {
    const body = {
      customer_id: 'cust_123',
      key_id: keyId,
      blockchain: 'ethereum',
      amount_usd: 500,
      transaction: baseTx(),
      metadata: { forge_payment_id: 'pay_xyz' },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sign',
      headers: signedHeaders('POST', '/api/v1/sign', body),
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.status).toBe('confirmed');
    expect(json.tx_hash).toMatch(/^0x/);
    expect(json.block_number).toBeGreaterThan(0);
  });

  it('holds threshold-hit requests for distinct-role approvals, then signs', async () => {
    createPolicy(workspaceId, 'approvals', {
      approvalThreshold: { amountUsd: 1_000_000, approvalsRequired: 2, roles: ['CFO', 'CEO'] },
    });
    const body = {
      customer_id: 'cust_123',
      key_id: keyId,
      blockchain: 'ethereum',
      amount_usd: 5_000_000,
      transaction: baseTx(),
      metadata: {},
    };
    const created = await app.inject({
      method: 'POST', url: '/api/v1/sign',
      headers: signedHeaders('POST', '/api/v1/sign', body), payload: body,
    });
    expect(created.json().status).toBe('pending_approval');
    const signingId = created.json().signing_id;

    const path = `/api/v1/signing/${signingId}/approve`;
    const approve1 = { approver_id: 'cfo@bank', approver_role: 'CFO' };
    const res1 = await app.inject({
      method: 'POST', url: path, headers: signedHeaders('POST', path, approve1), payload: approve1,
    });
    expect(res1.json().status).toBe('pending_approval');

    // Same role cannot approve twice.
    const approveDupRole = { approver_id: 'cfo2@bank', approver_role: 'CFO' };
    const resDup = await app.inject({
      method: 'POST', url: path, headers: signedHeaders('POST', path, approveDupRole), payload: approveDupRole,
    });
    expect(resDup.statusCode).toBe(409);

    const approve2 = { approver_id: 'ceo@bank', approver_role: 'CEO' };
    const res2 = await app.inject({
      method: 'POST', url: path, headers: signedHeaders('POST', path, approve2), payload: approve2,
    });
    expect(res2.json().status).toBe('confirmed');
    expect(res2.json().tx_hash).toMatch(/^0x/);
  });

  it('rejects and records requests that fail policy', async () => {
    createPolicy(workspaceId, 'wl', { whitelist: ['0xonlythisone'] });
    const body = {
      customer_id: 'cust_123', key_id: keyId, blockchain: 'ethereum', amount_usd: 10,
      transaction: baseTx({ to: '0xsomewhereelse' }), metadata: {},
    };
    const res = await app.inject({
      method: 'POST', url: '/api/v1/sign',
      headers: signedHeaders('POST', '/api/v1/sign', body), payload: body,
    });
    expect(res.json().status).toBe('rejected');
    expect(res.json().reason_code).toBe('DESTINATION_NOT_WHITELISTED');
  });
});

describe('audit trail', () => {
  it('appends audit entries for signing actions', async () => {
    const before = auditLog.length;
    const body = {
      customer_id: 'cust_123', key_id: keyId, blockchain: 'ethereum', amount_usd: 5,
      transaction: baseTx(), metadata: {},
    };
    await app.inject({
      method: 'POST', url: '/api/v1/sign',
      headers: signedHeaders('POST', '/api/v1/sign', body), payload: body,
    });
    expect(auditLog.length).toBeGreaterThan(before);
    const actions = auditLog.slice(before).map((e) => e.action);
    expect(actions).toContain('signing.create');
  });
});

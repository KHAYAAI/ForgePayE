/**
 * Institution API key lifecycle: several keys at once, issue, revoke, expire, and who may do what.
 * The unit tests cover the pure functions; the route tests go through the real app and auth hook.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';
import { hashApiKey } from './hash';
import { activeKeyCount, issueKey, listKeys, matchKey, MAX_ACTIVE_KEYS, PRIMARY_KEY_ID, revokeKey, touchKey } from './contributor-keys';
import type { DataContributor } from './types';

const ADMIN = 'dev-bureau-admin-key';
const bearer = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });
/** GET and DELETE carry no body, so they send no content-type (Fastify rejects a JSON content-type with an empty body). */
const plain = (key: string) => ({ authorization: `Bearer ${key}` });

function contributor(primaryRaw = 'ck_primary'): DataContributor {
  return {
    id: 'c1', name: 'Test MFI', type: 'defi_protocol', apiKeyHash: hashApiKey(primaryRaw), permissions: ['pull_scores'],
    queriesUsed: 0, queriesAllowed: 5000, dataRecordsContributed: 0, createdAt: '2026-01-01T00:00:00.000Z', status: 'active',
  };
}

describe('key lifecycle (unit)', () => {
  it('the registration key is the primary key and works until revoked', () => {
    const c = contributor();
    expect(matchKey(c, hashApiKey('ck_primary'))).toBe(PRIMARY_KEY_ID);
    expect(matchKey(c, hashApiKey('something else'))).toBeNull();
  });

  it('an issued key works alongside the primary and is shown once, never stored raw', () => {
    const c = contributor();
    const r = issueKey(c, { label: 'prod' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.rawKey.startsWith('ck_')).toBe(true);
    expect(matchKey(c, hashApiKey(r.rawKey))).toBe(r.key.id);
    expect(matchKey(c, hashApiKey('ck_primary'))).toBe(PRIMARY_KEY_ID);
    expect(JSON.stringify(c)).not.toContain(r.rawKey);
    expect(JSON.stringify(listKeys(c))).not.toContain(hashApiKey(r.rawKey)); // listing carries no hashes
  });

  it('a revoked key matches nothing, and the others keep working', () => {
    const c = contributor();
    const r = issueKey(c, {});
    if (!r.ok) throw new Error('expected ok');
    expect(revokeKey(c, PRIMARY_KEY_ID, false).ok).toBe(true);
    expect(matchKey(c, hashApiKey('ck_primary'))).toBeNull();
    expect(matchKey(c, hashApiKey(r.rawKey))).toBe(r.key.id);
  });

  it('an institution cannot revoke its only active key, but an operator can', () => {
    const c = contributor();
    const blocked = revokeKey(c, PRIMARY_KEY_ID, false);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe('LastKey');
    expect(matchKey(c, hashApiKey('ck_primary'))).toBe(PRIMARY_KEY_ID);
    expect(revokeKey(c, PRIMARY_KEY_ID, true).ok).toBe(true);
    expect(activeKeyCount(c)).toBe(0);
  });

  it('an expired key stops working at its expiry time', () => {
    const c = contributor();
    const now = Date.parse('2026-06-01T00:00:00Z');
    const r = issueKey(c, { expiresInDays: 1 }, now);
    if (!r.ok) throw new Error('expected ok');
    expect(matchKey(c, hashApiKey(r.rawKey), now + 3_600_000)).toBe(r.key.id);
    expect(matchKey(c, hashApiKey(r.rawKey), now + 86_400_000 + 1)).toBeNull();
    expect(listKeys(c, now + 2 * 86_400_000).find((k) => k.id === r.key.id)?.status).toBe('expired');
  });

  it('there is a ceiling on active keys, and revoking one makes room', () => {
    const c = contributor();
    for (let i = 1; i < MAX_ACTIVE_KEYS; i++) expect(issueKey(c, {}).ok).toBe(true); // primary is the first
    const over = issueKey(c, {});
    expect(over.ok).toBe(false);
    expect(revokeKey(c, PRIMARY_KEY_ID, false).ok).toBe(true);
    expect(issueKey(c, {}).ok).toBe(true);
  });

  it('revoking an unknown or already revoked key is reported, not ignored', () => {
    const c = contributor();
    issueKey(c, {});
    const missing = revokeKey(c, 'key_nope', true);
    expect(missing.ok).toBe(false);
    revokeKey(c, PRIMARY_KEY_ID, false);
    const again = revokeKey(c, PRIMARY_KEY_ID, true);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe('AlreadyRevoked');
  });

  it('last-used is recorded, and only asks for a write now and then', () => {
    const c = contributor();
    const r = issueKey(c, {});
    if (!r.ok) throw new Error('expected ok');
    const t0 = Date.parse('2026-06-01T00:00:00Z');
    expect(touchKey(c, r.key.id, t0)).toBe(true);          // first use: persist
    expect(touchKey(c, r.key.id, t0 + 60_000)).toBe(false); // a minute later: memory only
    expect(touchKey(c, r.key.id, t0 + 11 * 60_000)).toBe(true);
    expect(listKeys(c).find((k) => k.id === r.key.id)?.lastUsedAt).toBeDefined();
  });
});

describe('key routes', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  async function activeInstitution(name: string, permissions = ['pull_scores']) {
    const reg = await app.inject({ method: 'POST', url: '/v1/contributors', headers: bearer(ADMIN), payload: { name, type: 'defi_protocol', permissions } });
    const { id, apiKey } = reg.json().data;
    await app.inject({ method: 'PUT', url: `/v1/contributors/${id}/status`, headers: bearer(ADMIN), payload: { status: 'active', reason: 'test' } });
    return { id, key: apiKey as string };
  }

  it('rotation with no downtime: issue, use the new key, revoke the old, the old is refused', async () => {
    const inst = await activeInstitution('Rotation MFI');
    const issued = await app.inject({ method: 'POST', url: `/v1/contributors/${inst.id}/keys`, headers: bearer(inst.key), payload: { label: 'second' } });
    expect(issued.statusCode).toBe(201);
    const next = issued.json().data.apiKey as string;

    const withNew = await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/keys`, headers: plain(next) });
    expect(withNew.statusCode).toBe(200);
    expect(withNew.json().data.keys).toHaveLength(2);

    const revoke = await app.inject({ method: 'DELETE', url: `/v1/contributors/${inst.id}/keys/${PRIMARY_KEY_ID}`, headers: plain(next) });
    expect(revoke.statusCode).toBe(200);

    const old = await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/keys`, headers: plain(inst.key) });
    expect(old.statusCode).toBe(401);
    const still = await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/keys`, headers: plain(next) });
    expect(still.statusCode).toBe(200);
  });

  it('works for a lender-only institution with no ingest scope (self service is implicit)', async () => {
    const inst = await activeInstitution('Lender Only', ['pull_scores']);
    const res = await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/keys`, headers: plain(inst.key) });
    expect(res.statusCode).toBe(200);
  });

  it('one institution cannot see, issue or revoke another institution\'s keys', async () => {
    const a = await activeInstitution('Inst A');
    const b = await activeInstitution('Inst B');
    for (const [method, url] of [
      ['GET', `/v1/contributors/${b.id}/keys`], ['POST', `/v1/contributors/${b.id}/keys`], ['DELETE', `/v1/contributors/${b.id}/keys/${PRIMARY_KEY_ID}`],
    ] as const) {
      const res = await app.inject({ method, url, headers: method === 'POST' ? bearer(a.key) : plain(a.key), payload: method === 'POST' ? {} : undefined });
      expect(res.statusCode).toBe(403);
    }
    // and B is untouched
    const still = await app.inject({ method: 'GET', url: `/v1/contributors/${b.id}/keys`, headers: plain(b.key) });
    expect(still.json().data.keys[0].status).toBe('active');
  });

  it('an institution is refused when it tries to revoke its last key; an operator may', async () => {
    const inst = await activeInstitution('Last Key Inc');
    const own = await app.inject({ method: 'DELETE', url: `/v1/contributors/${inst.id}/keys/${PRIMARY_KEY_ID}`, headers: plain(inst.key) });
    expect(own.statusCode).toBe(409);
    expect(own.json().error).toBe('LastKey');
    const op = await app.inject({ method: 'DELETE', url: `/v1/contributors/${inst.id}/keys/${PRIMARY_KEY_ID}`, headers: plain(ADMIN) });
    expect(op.statusCode).toBe(200);
    const dead = await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/keys`, headers: plain(inst.key) });
    expect(dead.statusCode).toBe(401);
  });

  it('no response ever contains a key hash or a raw key other than at issue', async () => {
    const inst = await activeInstitution('Leak Check');
    const issued = await app.inject({ method: 'POST', url: `/v1/contributors/${inst.id}/keys`, headers: bearer(inst.key), payload: {} });
    const raw = issued.json().data.apiKey as string;
    const list = await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/keys`, headers: plain(inst.key) });
    expect(list.body).not.toContain(raw);
    expect(list.body).not.toContain(hashApiKey(raw));
    expect(list.body).not.toContain(hashApiKey(inst.key));
    const stats = await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/stats`, headers: plain(ADMIN) });
    expect(stats.body).not.toContain(hashApiKey(raw));
  });

  it('a suspended institution\'s extra keys stop working too', async () => {
    const inst = await activeInstitution('Suspend Me');
    const issued = await app.inject({ method: 'POST', url: `/v1/contributors/${inst.id}/keys`, headers: bearer(inst.key), payload: {} });
    const extra = issued.json().data.apiKey as string;
    await app.inject({ method: 'PUT', url: `/v1/contributors/${inst.id}/status`, headers: bearer(ADMIN), payload: { status: 'suspended', reason: 'test' } });
    const res = await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/keys`, headers: plain(extra) });
    expect(res.statusCode).toBe(401);
  });

  it('keys survive in the redacted contributor record without hashes', async () => {
    const inst = await activeInstitution('Redaction', ['pull_scores', 'ingest_events']);
    await app.inject({ method: 'POST', url: `/v1/contributors/${inst.id}/keys`, headers: bearer(inst.key), payload: {} });
    const stats = await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/stats`, headers: plain(inst.key) });
    expect(stats.statusCode).toBe(200);
    expect(JSON.stringify(stats.json())).not.toMatch(/"hash"/);
  });
});

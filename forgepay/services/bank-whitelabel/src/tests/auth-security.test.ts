/**
 * Who can create admins.
 *
 * POST /v1/auth/seed created admins, super_admins included, for any bank with no authentication, in every environment. In
 * production that let anyone who could reach the service take over every bank's data. These tests run the real auth routes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { registerAuthRoutes, registerBootstrapRoute } from '../auth.js';
import { Admins, Banks, hashPassword, hydrateStore } from '../store.js';
import type { Bank } from '../types.js';

const SAVED = { ...process.env };
const SECRET = 'x'.repeat(40);
const BOOT = 'b'.repeat(40);

const bank = (id: string): Bank => ({
  id, name: id, slug: id, webhookFormat: 'forgepay', kycInherited: true, amlLevel: 'inherited', settlementCurrency: 'USD',
  settlementSchedule: 'daily', createdAt: new Date().toISOString(), status: 'active', adminEmails: [],
});

let app: FastifyInstance;
async function build(): Promise<FastifyInstance> {
  const a = Fastify();
  await a.register(jwt, { secret: SECRET });
  await registerAuthRoutes(a);
  await registerBootstrapRoute(a);
  await a.ready();
  return a;
}
const token = (payload: object) => app.jwt.sign(payload, { expiresIn: '1h' });
const post = (url: string, body: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', ...headers }, payload: body });

beforeEach(async () => {
  hydrateStore({ banks: [bank('acme')], admins: [], customers: [], transactions: [], audit: [] });
  app = await build();
});
afterEach(async () => { await app.close(); process.env = { ...SAVED }; });

describe('POST /v1/auth/seed', () => {
  const body = { bankId: 'acme', email: 'new@acme.test', password: 'a-long-enough-password', role: 'super_admin' };

  it('stays open in development, for local use', async () => {
    process.env['NODE_ENV'] = 'development';
    expect((await post('/v1/auth/seed', body)).statusCode).toBe(201);
  });

  it('in production, refuses a caller with no credentials (the original hole)', async () => {
    process.env['NODE_ENV'] = 'production';
    const res = await post('/v1/auth/seed', body);
    expect(res.statusCode).toBe(401);
    expect(Admins.count()).toBe(0);
  });

  it('in production, refuses an ordinary admin or viewer', async () => {
    process.env['NODE_ENV'] = 'production';
    for (const role of ['admin', 'viewer']) {
      const res = await post('/v1/auth/seed', body, { authorization: `Bearer ${token({ adminId: 'x', bankId: 'acme', role })}` });
      expect(res.statusCode).toBe(403);
    }
    expect(Admins.count()).toBe(0);
  });

  it('in production, refuses a forged token', async () => {
    process.env['NODE_ENV'] = 'production';
    // signed with a different secret than the service's
    const { createSigner } = await import('fast-jwt');
    const forged = createSigner({ key: 'a-different-secret-entirely-xxxxxxxxxxxx' })({ adminId: 'x', bankId: 'acme', role: 'super_admin' });
    expect(forged.split('.')).toHaveLength(3);
    expect((await post('/v1/auth/seed', body, { authorization: `Bearer ${forged}` })).statusCode).toBe(401);
  });

  it('in production, lets a signed-in super_admin create admins, and holds them to a real password', async () => {
    process.env['NODE_ENV'] = 'production';
    const auth = { authorization: `Bearer ${token({ adminId: 'root', bankId: 'acme', role: 'super_admin' })}` };
    expect((await post('/v1/auth/seed', { ...body, password: 'short' }, auth)).statusCode).toBe(400);
    expect((await post('/v1/auth/seed', body, auth)).statusCode).toBe(201);
    expect(Admins.findByEmail('new@acme.test')?.role).toBe('super_admin');
  });
});

describe('POST /v1/auth/bootstrap (the first super_admin in production)', () => {
  const body = { email: 'root@forge.test', password: 'a-long-enough-password' };

  it('does not exist unless a strong BANK_BOOTSTRAP_TOKEN is configured', async () => {
    delete process.env['BANK_BOOTSTRAP_TOKEN'];
    expect((await post('/v1/auth/bootstrap', body)).statusCode).toBe(404);
    process.env['BANK_BOOTSTRAP_TOKEN'] = 'too-short';
    expect((await post('/v1/auth/bootstrap', body, { 'x-bootstrap-token': 'too-short' })).statusCode).toBe(404);
    expect(Admins.count()).toBe(0);
  });

  it('refuses a missing or wrong token', async () => {
    process.env['BANK_BOOTSTRAP_TOKEN'] = BOOT;
    expect((await post('/v1/auth/bootstrap', body)).statusCode).toBe(401);
    expect((await post('/v1/auth/bootstrap', body, { 'x-bootstrap-token': 'c'.repeat(40) })).statusCode).toBe(401);
    expect(Admins.count()).toBe(0);
  });

  it('creates the first super_admin on a platform bank, who can then sign in', async () => {
    process.env['BANK_BOOTSTRAP_TOKEN'] = BOOT;
    const res = await post('/v1/auth/bootstrap', body, { 'x-bootstrap-token': BOOT });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ role: 'super_admin', bankId: 'platform' });
    expect(Banks.findById('platform')).toBeDefined();
    const login = await post('/v1/auth/login', body);
    expect(login.statusCode).toBe(200);
    expect(login.json().role).toBe('super_admin');
  });

  it('works only once: with an admin in place a leaked token cannot add another super_admin', async () => {
    process.env['BANK_BOOTSTRAP_TOKEN'] = BOOT;
    Admins.create({ id: 'a1', bankId: 'acme', email: 'a@acme.test', passwordHash: hashPassword('whatever-long-enough'), role: 'admin', createdAt: new Date().toISOString() });
    const res = await post('/v1/auth/bootstrap', body, { 'x-bootstrap-token': BOOT });
    expect(res.statusCode).toBe(409);
    expect(Admins.findByEmail('root@forge.test')).toBeUndefined();
  });

  it('holds the first admin to a real password', async () => {
    process.env['BANK_BOOTSTRAP_TOKEN'] = BOOT;
    expect((await post('/v1/auth/bootstrap', { ...body, password: 'short' }, { 'x-bootstrap-token': BOOT })).statusCode).toBe(400);
  });
});

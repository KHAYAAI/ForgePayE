import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hit, _clearAll } from './rate-limit';

process.env.JWT_SECRET = 'j'.repeat(48);

describe('rate limit', () => {
  beforeEach(_clearAll);
  it('allows up to the limit then refuses until the window passes', () => {
    for (let i = 0; i < 3; i++) expect(hit('k', 3, 1000, 0).allowed).toBe(true);
    const r = hit('k', 3, 1000, 10);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(hit('k', 3, 1000, 1500).allowed).toBe(true);
  });
  it('keys are independent', () => {
    hit('a', 1, 1000, 0); expect(hit('a', 1, 1000, 1).allowed).toBe(false);
    expect(hit('b', 1, 1000, 1).allowed).toBe(true);
  });
});

describe('TOTP secret at rest', () => {
  it('is not stored in the clear, round-trips, and reads legacy plaintext', async () => {
    const { sealSecret, openSecret } = await import('./secret-box');
    const stored = sealSecret('JBSWY3DPEHPK3PXP');
    expect(stored.startsWith('enc1:')).toBe(true);
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(openSecret(stored)).toBe('JBSWY3DPEHPK3PXP');
    expect(openSecret('LEGACYPLAINTEXT')).toBe('LEGACYPLAINTEXT');
    expect(sealSecret('x')).not.toBe(sealSecret('x')); // fresh nonce each time
  });
  it('a tampered value is refused, not silently read', async () => {
    const { sealSecret, openSecret } = await import('./secret-box');
    const s = sealSecret('SECRET');
    const bad = s.slice(0, -2) + (s.endsWith('A') ? 'B' : 'A') + s.slice(-1);
    expect(() => openSecret(bad)).toThrow();
  });
});

describe('SSO cannot take over an account in another tenant', () => {
  it('refuses when the email already belongs to a different tenant, allows the same tenant', async () => {
    vi.resetModules();
    vi.doMock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }));
    const existing = { id: 'u1', email: 'victim@corp.com', tenant_id: 'tenant-A', password_hash: 'x' };
    vi.doMock('./db', () => ({ query: async () => [], queryOne: async () => existing, execute: async () => undefined }));
    const { findOrCreateSsoUser, SsoTenantMismatchError } = await import('./auth');
    await expect(findOrCreateSsoUser('victim@corp.com', 'V', 'tenant-B')).rejects.toBeInstanceOf(SsoTenantMismatchError);
    await expect(findOrCreateSsoUser('victim@corp.com', 'V', 'tenant-A')).resolves.toMatchObject({ id: 'u1' });
  });
});

describe('route guard', () => {
  async function guardWith(user: any, products: string[]) {
    vi.resetModules();
    vi.doMock('./auth', () => ({ getCurrentUser: async () => user }));
    vi.doMock('./products', () => ({ getEnabledProducts: async () => products }));
    vi.doMock('next/server', () => ({ NextResponse: { json: (b: unknown, i?: { status?: number }) => ({ body: b, status: i?.status ?? 200 }) } }));
    return (await import('./route-guard')).guardRoute;
  }
  it('no session is 401; missing product or permission is 403; a good request passes', async () => {
    const owner = { userId: 'u', email: 'a@b.co', tenantId: 't', role: 'owner' };
    const analyst = { ...owner, role: 'analyst' };
    expect(((await (await guardWith(null, [])) ({ product: 'credit-bureau' })) as any).response.status).toBe(401);
    expect(((await (await guardWith(owner, [])) ({ product: 'credit-bureau' })) as any).response.status).toBe(403);
    expect(((await (await guardWith(analyst, ['credit-bureau'])) ({ product: 'credit-bureau', permission: 'manage:billing' })) as any).response.status).toBe(403);
    expect(await (await guardWith(owner, ['credit-bureau'])) ({ product: 'credit-bureau', permission: 'manage:billing' })).toHaveProperty('user');
  });
});

describe('per-user API keys are stored hashed', () => {
  it('generateApiKey returns the key once and stores only its hash; verifyApiKey finds it by hash', async () => {
    vi.resetModules();
    vi.doUnmock('./auth');
    vi.doMock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }));
    const stored: string[] = [];
    vi.doMock('./db', () => ({
      query: async (_sql: string, params: string[]) => { stored.push(params[0]!); return []; },
      queryOne: async (_sql: string, params: string[]) => (stored.includes(params[0]!) ? { id: 'u1' } : null),
      execute: async () => undefined,
    }));
    const { generateApiKey, verifyApiKey, hashApiKey } = await import('./auth');
    const key = await generateApiKey('u1');
    expect(stored[0]).toBe(hashApiKey(key));
    expect(stored[0]).not.toContain(key);
    expect(await verifyApiKey(key)).toMatchObject({ id: 'u1' });
    expect(await verifyApiKey('wrong')).toBeNull();
  });
});

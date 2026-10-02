import { assertNoDemoCredential, DEMO_KEY_HASH } from './demo-credential.guard';

describe('demo credential guard', () => {
  const pool = (rows: any[]) => ({ query: jest.fn(async () => ({ rows })) }) as any;
  it('refuses to start in production when the public demo key is in the database', async () => {
    await expect(assertNoDemoCredential(pool([{ customer_id: 'demo' }]), true)).rejects.toThrow(/public demo API key/);
  });
  it('is quiet when it is absent, and does not look in development', async () => {
    await expect(assertNoDemoCredential(pool([]), true)).resolves.toBeUndefined();
    const p = pool([{ customer_id: 'demo' }]);
    await expect(assertNoDemoCredential(p, false)).resolves.toBeUndefined();
    expect(p.query).not.toHaveBeenCalled();
  });
  it('knows the real hash of dev-demo-key', () => {
    expect(require('crypto').createHash('sha256').update('dev-demo-key').digest('hex')).toBe(DEMO_KEY_HASH);
  });
});

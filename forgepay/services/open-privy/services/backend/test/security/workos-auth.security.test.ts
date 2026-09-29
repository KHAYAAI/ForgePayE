import { AuthService } from '../../src/modules/auth/auth.service';
import { WorkOsAuthResult } from '../../src/modules/auth/workos.service';

/**
 * WorkOS login upserts a local user and mints OUR jwt. The identity mapping is
 * security-sensitive: a returning WorkOS user must resolve to the same local
 * user (and the wallet-owning uuid), an existing email must be linked rather
 * than duplicated, and the minted token must carry the local uuid as `sub`.
 */
describe('AuthService.loginWithWorkOs', () => {
  const profile: WorkOsAuthResult = {
    workosUserId: 'user_01ABC',
    email: 'alice@openprivy.io',
    firstName: 'Alice',
    lastName: 'A',
    emailVerified: true,
    organizationId: 'org_01XYZ',
  };

  function makeService(existing: any | null) {
    const saved: any[] = [];
    const repo: any = {
      findOne: jest.fn(async ({ where }: any) => {
        if (where.workosUserId && existing?.workosUserId === where.workosUserId) return existing;
        if (where.email && existing?.email === where.email) return existing;
        return null;
      }),
      create: jest.fn((data: any) => ({ id: 'uuid-generated', ...data })),
      save: jest.fn(async (u: any) => {
        if (!u.id) u.id = 'uuid-generated';
        saved.push(u);
        return u;
      }),
    };
    const jwt: any = { sign: jest.fn((p: any) => `jwt(${p.sub})`) };
    const svc = new AuthService(repo as any, jwt as any);
    return { svc, repo, jwt, saved };
  }

  it('creates a new local user with the workos id and mints a jwt on our uuid', async () => {
    const { svc, jwt, saved } = makeService(null);
    const res = await svc.loginWithWorkOs(profile);

    expect(saved[0].workosUserId).toBe('user_01ABC');
    expect(saved[0].email).toBe('alice@openprivy.io');
    // Token subject is the LOCAL uuid (what wallets key on), not the WorkOS id.
    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'uuid-generated', email: profile.email });
    expect(res.access_token).toBe('jwt(uuid-generated)');
    expect(res.user.id).toBe('uuid-generated');
  });

  it('links an existing email account to the workos id (no duplicate)', async () => {
    const existing = {
      id: 'uuid-existing',
      email: 'alice@openprivy.io',
      workosUserId: null,
      emailVerified: false,
    };
    const { svc, jwt, saved } = makeService(existing);
    const res = await svc.loginWithWorkOs(profile);

    expect(saved[0].id).toBe('uuid-existing');
    expect(saved[0].workosUserId).toBe('user_01ABC');
    expect(res.access_token).toBe('jwt(uuid-existing)');
  });

  it('resolves a returning workos user to the same local uuid', async () => {
    const existing = {
      id: 'uuid-existing',
      email: 'alice@openprivy.io',
      workosUserId: 'user_01ABC',
      emailVerified: true,
    };
    const { svc, jwt } = makeService(existing);
    const res = await svc.loginWithWorkOs(profile);

    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'uuid-existing', email: profile.email });
    expect(res.user.id).toBe('uuid-existing');
  });
});

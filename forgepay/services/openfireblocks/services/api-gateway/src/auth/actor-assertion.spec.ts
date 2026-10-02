import { signActorAssertion, verifyActorAssertion } from './actor-assertion';

const SECRET = 's'.repeat(40);
const path = '/admin/customers/c1/custody/proposals/p1/votes';

describe('actor assertions', () => {
  it('accepts a request signed for exactly that actor, method, path and body, once', () => {
    const h = signActorAssertion(SECRET, 'Alice@Example.com', 'POST', path, { approve: true });
    expect(verifyActorAssertion(SECRET, h, 'alice@example.com', 'POST', path, { approve: true })).toBeNull();
    expect(verifyActorAssertion(SECRET, h, 'alice@example.com', 'POST', path, { approve: true })).toMatch(/already used/);
  });

  it('refuses a missing header, a wrong secret (a leaked admin key alone), another actor, a changed body or path', () => {
    const sign = (b: unknown = { approve: true }) => signActorAssertion(SECRET, 'alice@example.com', 'POST', path, b);
    expect(verifyActorAssertion(SECRET, undefined, 'alice@example.com', 'POST', path, {})).toMatch(/missing/);
    expect(verifyActorAssertion(SECRET, signActorAssertion('x'.repeat(40), 'alice@example.com', 'POST', path, { approve: true }), 'alice@example.com', 'POST', path, { approve: true })).toMatch(/does not match/);
    expect(verifyActorAssertion(SECRET, sign(), 'bob@example.com', 'POST', path, { approve: true })).toMatch(/does not match/);
    expect(verifyActorAssertion(SECRET, sign(), 'alice@example.com', 'POST', path, { approve: false })).toMatch(/does not match/);
    expect(verifyActorAssertion(SECRET, sign(), 'alice@example.com', 'POST', path + 'x', { approve: true })).toMatch(/does not match/);
    expect(verifyActorAssertion(SECRET, 'garbage', 'alice@example.com', 'POST', path, {})).toMatch(/malformed/);
  });

  it('expires, and treats an absent body and {} alike', () => {
    const old = signActorAssertion(SECRET, 'a@b.co', 'POST', path, undefined, Date.now() - 5 * 60_000);
    expect(verifyActorAssertion(SECRET, old, 'a@b.co', 'POST', path, {})).toMatch(/expired/);
    const fresh = signActorAssertion(SECRET, 'a@b.co', 'POST', path, undefined);
    expect(verifyActorAssertion(SECRET, fresh, 'a@b.co', 'POST', path, {})).toBeNull();
  });
});

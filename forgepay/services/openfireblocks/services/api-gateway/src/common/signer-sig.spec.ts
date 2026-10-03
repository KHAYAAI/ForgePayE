import { generateSignerKey, signMessage, verifySignature, voteMessage, enrollMessage, payloadDigest, signaturesRequired } from './signer-sig';

describe('per-signer signatures', () => {
  const k = generateSignerKey();
  const digest = payloadDigest('c1', 'approve_transaction', 'r1', { request: { to: '0x1', value: '5' }, reason: 'x', _seal: 'ignored' });

  it('a signature verifies only for the exact proposal, decision and signer', () => {
    const msg = voteMessage('c1', 'p1', 'approve_transaction', digest, true);
    const sig = signMessage(k.privateKeyHex, msg);
    expect(verifySignature(k.publicKeyHex, msg, sig)).toBe(true);
    expect(verifySignature(k.publicKeyHex, voteMessage('c1', 'p2', 'approve_transaction', digest, true), sig)).toBe(false); // another proposal
    expect(verifySignature(k.publicKeyHex, voteMessage('c1', 'p1', 'approve_transaction', digest, false), sig)).toBe(false); // other decision
    expect(verifySignature(k.publicKeyHex, voteMessage('c2', 'p1', 'approve_transaction', digest, true), sig)).toBe(false); // other workspace
    const other = generateSignerKey();
    expect(verifySignature(other.publicKeyHex, msg, sig)).toBe(false); // someone else's key
  });

  it('a changed payload changes the digest, so an approved transfer cannot be altered under a valid signature', () => {
    const changed = payloadDigest('c1', 'approve_transaction', 'r1', { request: { to: '0xEVIL', value: '5' }, reason: 'x' });
    expect(changed).not.toBe(digest);
    const sig = signMessage(k.privateKeyHex, voteMessage('c1', 'p1', 'approve_transaction', digest, true));
    expect(verifySignature(k.publicKeyHex, voteMessage('c1', 'p1', 'approve_transaction', changed, true), sig)).toBe(false);
  });

  it('the seal is not part of the digest, and key order does not matter', () => {
    expect(payloadDigest('c1', 'k', null, { b: 1, a: { d: 2, c: 3 } })).toBe(payloadDigest('c1', 'k', null, { a: { c: 3, d: 2 }, b: 1, _seal: 'x' }));
  });

  it('proof of possession binds an email and a key; garbage never verifies or throws', () => {
    const pop = signMessage(k.privateKeyHex, enrollMessage('c1', 'Alice@Example.com', k.publicKeyHex));
    expect(verifySignature(k.publicKeyHex, enrollMessage('c1', 'alice@example.com', k.publicKeyHex), pop)).toBe(true);
    expect(verifySignature(k.publicKeyHex, enrollMessage('c1', 'mallory@example.com', k.publicKeyHex), pop)).toBe(false);
    for (const bad of ['', 'zz', 'a'.repeat(128)]) expect(verifySignature(k.publicKeyHex, 'm', bad)).toBe(false);
    expect(verifySignature('nothex', 'm', 'a'.repeat(128))).toBe(false);
  });

  it('is required in production by default, and can be set either way explicitly', () => {
    expect(signaturesRequired({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
    expect(signaturesRequired({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
    expect(signaturesRequired({ NODE_ENV: 'development', CUSTODY_REQUIRE_SIGNER_SIGNATURES: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(signaturesRequired({ NODE_ENV: 'production', CUSTODY_REQUIRE_SIGNER_SIGNATURES: 'false' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

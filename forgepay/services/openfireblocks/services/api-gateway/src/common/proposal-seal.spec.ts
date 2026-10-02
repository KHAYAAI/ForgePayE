import { sealPayload, checkPayloadSeal, canonicalJson } from './proposal-seal';

const env = { CUSTODY_PROPOSAL_SECRET: 'p'.repeat(40), NODE_ENV: 'production' } as NodeJS.ProcessEnv;
const request = { to: '0x' + '11'.repeat(20), value: '1000', data: '0x' };

describe('proposal payload seal', () => {
  it('accepts the payload that was voted on, even after the database reorders its keys', () => {
    const sealed = sealPayload('c1', 'approve_transaction', 'r1', { request, reason: 'x' }, env);
    const reordered = JSON.parse(JSON.stringify({ reason: 'x', _seal: sealed._seal, request: { data: '0x', value: '1000', to: request.to } }));
    expect(checkPayloadSeal('c1', 'approve_transaction', 'r1', reordered, env)).toBeNull();
  });

  it('refuses a payload altered after the votes (a different destination or amount)', () => {
    const sealed = sealPayload('c1', 'approve_transaction', 'r1', { request, reason: 'x' }, env);
    const evil = { ...sealed, request: { ...request, to: '0x' + 'ee'.repeat(20) } };
    expect(checkPayloadSeal('c1', 'approve_transaction', 'r1', evil, env)).toMatch(/altered/);
    expect(checkPayloadSeal('c1', 'approve_transaction', 'r1', { ...sealed, request: { ...request, value: '999999' } }, env)).toMatch(/altered/);
  });

  it('is bound to the customer, kind and request id: a seal cannot be moved to another proposal', () => {
    const sealed = sealPayload('c1', 'approve_transaction', 'r1', { request }, env);
    expect(checkPayloadSeal('c2', 'approve_transaction', 'r1', sealed, env)).toMatch(/altered/);
    expect(checkPayloadSeal('c1', 'approve_transaction', 'r2', sealed, env)).toMatch(/altered/);
    expect(checkPayloadSeal('c1', 'rotate_key', 'r1', sealed, env)).toMatch(/altered/);
  });

  it('a proposal with no seal is refused when a secret exists; no secret in production refuses everything', () => {
    expect(checkPayloadSeal('c1', 'add_signer', null, { email: 'a@b.co' }, env)).toMatch(/no integrity seal/);
    expect(checkPayloadSeal('c1', 'add_signer', null, { email: 'a@b.co' }, { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toMatch(/CUSTODY_PROPOSAL_SECRET/);
    expect(checkPayloadSeal('c1', 'add_signer', null, { email: 'a@b.co' }, { NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('canonical json sorts keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: [2, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[2,{"y":2,"z":1}],"d":1},"b":1}');
  });
});

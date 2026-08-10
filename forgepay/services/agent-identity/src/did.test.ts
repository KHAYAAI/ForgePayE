/**
 * Tests for the canonical DID module.
 *
 * Two of these guard regressions that were live in production code:
 *
 *  - The old `didToAddress` regex was unanchored, so a DID embedded in
 *    surrounding junk parsed successfully.
 *  - It returned the address exactly as written, so one account expressed in
 *    two cases produced two unequal `Address` strings.
 */
import { describe, expect, it } from 'vitest';
import {
  parseDid,
  isCanonical,
  isValidDid,
  addressFromDid,
  toCanonicalDid,
  toChecksumAddress,
  sameAddress,
  mintAgentDid,
  mintUserDid,
  didFromAddress,
} from './did';

const ADDR_LOWER = '0x7a3b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b';
const ADDR_CHECKSUMMED = toChecksumAddress(ADDR_LOWER);

describe('toChecksumAddress — EIP-55', () => {
  it('matches the published reference vectors', () => {
    for (const v of [
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
      '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
    ]) {
      expect(toChecksumAddress(v.toLowerCase())).toBe(v);
    }
  });

  it('is idempotent', () => {
    expect(toChecksumAddress(ADDR_CHECKSUMMED)).toBe(ADDR_CHECKSUMMED);
  });

  it('rejects anything that is not a 20-byte hex address', () => {
    expect(() => toChecksumAddress('0x123')).toThrow();
    expect(() => toChecksumAddress(ADDR_LOWER + 'ff')).toThrow();
    expect(() => toChecksumAddress('nonsense')).toThrow();
  });
});

describe('parseDid — canonical address form', () => {
  it('parses did:forge:0x… and checksums the address', () => {
    const p = parseDid(`did:forge:${ADDR_LOWER}`)!;
    expect(p).not.toBeNull();
    expect(p.method).toBe('forge');
    expect(p.form).toBe('address');
    expect(p.address).toBe(ADDR_CHECKSUMMED);
    expect(p.canonical).toBe(`did:forge:${ADDR_CHECKSUMMED}`);
  });

  it('treats an already-checksummed canonical DID as canonical', () => {
    expect(isCanonical(`did:forge:${ADDR_CHECKSUMMED}`)).toBe(true);
  });

  it('normalises case so one account yields one address', () => {
    const lower = parseDid(`did:forge:${ADDR_LOWER}`)!;
    const upper = parseDid(`did:forge:${ADDR_LOWER.toUpperCase().replace('0X', '0x')}`)!;
    expect(lower.address).toBe(upper.address);
    expect(lower.canonical).toBe(upper.canonical);
  });
});

describe('parseDid — canonical registry form', () => {
  it('parses the agent and user shapes forge-wallet already mints', () => {
    const agent = parseDid('did:forge:agent_2f1c8e9a-1111-4222-8333-444455556666')!;
    expect(agent.form).toBe('registry');
    expect(agent.id).toBe('agent_2f1c8e9a-1111-4222-8333-444455556666');
    expect(agent.address).toBeUndefined();

    expect(parseDid('did:forge:user_8842')!.form).toBe('registry');
  });

  it('reports no address for a registry DID — that is the correct answer', () => {
    expect(addressFromDid('did:forge:agent_001')).toBeNull();
  });
});

describe('legacy compatibility', () => {
  it('accepts did:fp:0x… and canonicalises it', () => {
    const p = parseDid(`did:fp:${ADDR_LOWER}`)!;
    expect(p.method).toBe('fp');
    expect(p.form).toBe('address');
    expect(p.address).toBe(ADDR_CHECKSUMMED);
    expect(p.canonical).toBe(`did:forge:${ADDR_CHECKSUMMED}`);
    expect(p.wasCanonical).toBe(false);
  });

  it('accepts did:forgepay:<id> as a registry identifier', () => {
    const p = parseDid('did:forgepay:treasury-oracle-1')!;
    expect(p.method).toBe('forgepay');
    expect(p.form).toBe('registry');
    expect(p.id).toBe('treasury-oracle-1');
    expect(p.canonical).toBe('did:forge:treasury-oracle-1');
  });

  it('rejects a did:fp: body that is not an address', () => {
    // did:fp: only ever denoted an address; a registry-looking body is malformed.
    expect(parseDid('did:fp:agent_001')).toBeNull();
  });

  it('resolves all three live formats found in the monorepo', () => {
    expect(isValidDid('did:forgepay:treasury-oracle-1')).toBe(true);   // agent-identity seed
    expect(isValidDid('did:forge:user_8842')).toBe(true);               // forge-wallet mint
    expect(isValidDid(`did:fp:${ADDR_LOWER}`)).toBe(true);              // bureau seed
  });
});

describe('parseDid — rejection', () => {
  // The regression: the previous regex was unanchored.
  it('rejects a DID embedded in surrounding text', () => {
    expect(parseDid(`garbage did:fp:${ADDR_LOWER} trailing`)).toBeNull();
    expect(parseDid(`  did:forge:${ADDR_LOWER}  `)).not.toBeNull(); // trimmed, still fine
  });

  it('rejects an over-long address body rather than matching a prefix of it', () => {
    expect(parseDid(`did:fp:${ADDR_LOWER}ff`)).toBeNull();
  });

  it('rejects unknown methods, empty bodies and non-strings', () => {
    for (const bad of [
      'did:key:z6Mk', 'did:web:example.com', 'did:ethr:0x1',
      'did:forge:', 'did:', 'did', '', 'x',
      'not-a-did', 'did::body',
    ]) {
      expect(parseDid(bad), `should reject ${JSON.stringify(bad)}`).toBeNull();
    }
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(parseDid(bad)).toBeNull();
    }
  });

  it('never throws on hostile input', () => {
    expect(() => parseDid('did:forge:' + 'x'.repeat(10_000))).not.toThrow();
    expect(() => parseDid('did:forge:0x' + 'z'.repeat(40))).not.toThrow();
  });
});

describe('minting', () => {
  it('mints canonical agent and user DIDs that round-trip', () => {
    const agent = mintAgentDid();
    expect(agent.startsWith('did:forge:agent_')).toBe(true);
    expect(isCanonical(agent)).toBe(true);
    expect(parseDid(agent)!.form).toBe('registry');

    const user = mintUserDid();
    expect(user.startsWith('did:forge:user_')).toBe(true);
    expect(isCanonical(user)).toBe(true);
  });

  it('mints unique identifiers', () => {
    expect(mintAgentDid()).not.toBe(mintAgentDid());
  });

  it('builds a self-certifying DID from an address and reads it back', () => {
    const did = didFromAddress(ADDR_LOWER);
    expect(did).toBe(`did:forge:${ADDR_CHECKSUMMED}`);
    expect(addressFromDid(did)).toBe(ADDR_CHECKSUMMED);
    expect(isCanonical(did)).toBe(true);
  });
});

describe('sameAddress', () => {
  it('compares accounts case-insensitively', () => {
    expect(sameAddress(ADDR_LOWER, ADDR_CHECKSUMMED)).toBe(true);
    expect(sameAddress(ADDR_LOWER, '0x' + '1'.repeat(40))).toBe(false);
  });

  it('treats a missing address as never equal', () => {
    expect(sameAddress(undefined, ADDR_LOWER)).toBe(false);
    expect(sameAddress(ADDR_LOWER, undefined)).toBe(false);
  });
});

describe('toCanonicalDid', () => {
  it('rewrites every accepted form and leaves canonical input alone', () => {
    expect(toCanonicalDid(`did:fp:${ADDR_LOWER}`)).toBe(`did:forge:${ADDR_CHECKSUMMED}`);
    expect(toCanonicalDid('did:forgepay:abc')).toBe('did:forge:abc');
    expect(toCanonicalDid('did:forge:agent_1')).toBe('did:forge:agent_1');
    expect(toCanonicalDid('rubbish')).toBeNull();
  });
});

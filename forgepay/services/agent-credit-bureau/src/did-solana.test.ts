/**
 * Solana identities: `did:forge:sol:<base58 public key>`. The EVM forms are covered in did.test.ts and must not change; these tests
 * also pin that adding Solana did not turn any previously valid DID invalid or the other way round.
 */
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  addressFromDid, base58Decode, didFromAddress, didFromSolanaAddress, isSolanaAddress, isValidDid, parseDid, solanaAddressFromDid,
} from './did';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)]! + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out;
}
/** A fresh, valid Solana address: the raw 32-byte ed25519 public key in base58. */
function freshAddress(): string {
  const spki = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' });
  return base58Encode(new Uint8Array(spki.subarray(spki.length - 32)));
}

const SYSTEM_PROGRAM = '11111111111111111111111111111111';          // 32 zero bytes
const EVM = '0x7a3b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b';

describe('base58', () => {
  it('round-trips arbitrary 32-byte keys, including ones that start with zero bytes', () => {
    for (let i = 0; i < 200; i++) {
      const a = freshAddress();
      expect(base58Encode(base58Decode(a)!)).toBe(a);
      expect(base58Decode(a)).toHaveLength(32);
    }
    const zeroLed = new Uint8Array(32); zeroLed[31] = 7; zeroLed[2] = 9;
    expect(base58Decode(base58Encode(zeroLed))).toEqual(zeroLed);
  });
  it('decodes the system program to 32 zero bytes', () => {
    expect(base58Decode(SYSTEM_PROGRAM)).toEqual(new Uint8Array(32));
  });
  it('rejects characters outside the alphabet', () => {
    for (const bad of ['0OIl', 'abc+/=', 'has space', '', '✓']) expect(base58Decode(bad)).toBeNull();
  });
});

describe('isSolanaAddress', () => {
  it('accepts a 32-byte key and refuses wrong lengths, non-base58 and non-strings', () => {
    expect(isSolanaAddress(freshAddress())).toBe(true);
    expect(isSolanaAddress(SYSTEM_PROGRAM)).toBe(true);
    expect(isSolanaAddress(base58Encode(new Uint8Array(20).fill(5)))).toBe(false);   // too short
    expect(isSolanaAddress(base58Encode(new Uint8Array(33).fill(5)))).toBe(false);   // too long
    expect(isSolanaAddress(EVM)).toBe(false);
    expect(isSolanaAddress('0'.repeat(40))).toBe(false);
    for (const bad of [null, undefined, 42, {}, []]) expect(isSolanaAddress(bad)).toBe(false);
  });
});

describe('parsing did:forge:sol:', () => {
  it('parses a Solana DID into its own form and leaves the EVM address empty', () => {
    const a = freshAddress();
    const p = parseDid(`did:forge:sol:${a}`)!;
    expect(p).toMatchObject({ method: 'forge', form: 'address', chain: 'solana', solanaAddress: a, canonical: `did:forge:sol:${a}`, wasCanonical: true });
    expect(p.address).toBeUndefined();
    expect(addressFromDid(`did:forge:sol:${a}`)).toBeNull();          // existing EVM callers see "no EVM address"
    expect(solanaAddressFromDid(`did:forge:sol:${a}`)).toBe(a);
    expect(didFromSolanaAddress(a)).toBe(`did:forge:sol:${a}`);
  });
  it('is case-sensitive: base58 changes meaning with case, so the address is kept verbatim', () => {
    const a = freshAddress();
    const lower = a.toLowerCase();
    expect(parseDid(`did:forge:sol:${a}`)!.solanaAddress).toBe(a);
    if (lower !== a && isSolanaAddress(lower)) expect(parseDid(`did:forge:sol:${lower}`)!.solanaAddress).toBe(lower);
  });
  it('treats `sol:` as reserved: a malformed Solana body is rejected, not accepted as a registry id', () => {
    for (const bad of ['did:forge:sol:', 'did:forge:sol:notanaddress', `did:forge:sol:${EVM}`, `did:forge:sol:${freshAddress()}x0`,
      `did:forge:sol:${base58Encode(new Uint8Array(20).fill(5))}`]) {
      expect(parseDid(bad), bad).toBeNull();
      expect(isValidDid(bad)).toBe(false);
    }
  });
  it('only the canonical method may carry it; the legacy aliases predate Solana', () => {
    const a = freshAddress();
    expect(parseDid(`did:fp:sol:${a}`)).toBeNull();
    expect(parseDid(`did:forgepay:sol:${a}`)).toBeNull();
  });
  it('never throws on hostile input', () => {
    expect(() => parseDid('did:forge:sol:' + '1'.repeat(10_000))).not.toThrow();
    expect(() => parseDid('did:forge:sol:' + 'z'.repeat(10_000))).not.toThrow();
  });
});

describe('nothing that worked before changed', () => {
  it('EVM and registry forms parse exactly as they did', () => {
    expect(parseDid(`did:forge:${EVM}`)).toMatchObject({ form: 'address', chain: 'evm' });
    expect(addressFromDid(didFromAddress(EVM))).toBe(didFromAddress(EVM).slice('did:forge:'.length));
    for (const ok of ['did:forge:agent_123', 'did:forge:user_9', 'did:forge:entity:EIN-12-3456789', 'did:forge:solarwinds', 'did:forge:sol']) {
      expect(parseDid(ok), ok).not.toBeNull();                          // `sol` alone, or a word starting "sol", is still a registry id
    }
    expect(parseDid('did:forge:agent_123')!.chain).toBeUndefined();
  });
});

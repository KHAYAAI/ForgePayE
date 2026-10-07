import { describe, expect, it } from 'vitest';
import { base58Encode, newSolanaWallet } from './testing/solana-wallet';
import { base58Decode, isSolanaAddress, SOLANA_SIGNATURE_SHAPE, verifySolanaSignature } from './solana-address';

describe('Solana addresses', () => {
  it('round-trips real keys through base58 and accepts only 32-byte keys', () => {
    for (let i = 0; i < 100; i++) {
      const w = newSolanaWallet();
      expect(isSolanaAddress(w.address)).toBe(true);
      expect(base58Encode(base58Decode(w.address)!)).toBe(w.address);
    }
    expect(isSolanaAddress('0x' + '1'.repeat(40))).toBe(false);
    expect(isSolanaAddress(base58Encode(new Uint8Array(20).fill(3)))).toBe(false);
    expect(isSolanaAddress('0OIl' + '1'.repeat(30))).toBe(false);
    for (const bad of [null, undefined, 1, {}]) expect(isSolanaAddress(bad)).toBe(false);
  });
});

describe('verifying an ed25519 message signature', () => {
  it('accepts the key\'s own signature and refuses another key, other text, and any malformed input', () => {
    const a = newSolanaWallet(); const b = newSolanaWallet();
    const sig = a.signMessage('link this wallet');
    expect(SOLANA_SIGNATURE_SHAPE.test(sig)).toBe(true);
    expect(verifySolanaSignature(a.address, 'link this wallet', sig)).toBe(true);
    expect(verifySolanaSignature(b.address, 'link this wallet', sig)).toBe(false);
    expect(verifySolanaSignature(a.address, 'link this wallet!', sig)).toBe(false);
    const tampered = Buffer.from(sig, 'base64'); tampered[0] = tampered[0]! ^ 1;
    expect(verifySolanaSignature(a.address, 'link this wallet', tampered.toString('base64'))).toBe(false);
    for (const bad of ['', 'not base64!!', Buffer.alloc(63).toString('base64'), Buffer.alloc(65).toString('base64')]) {
      expect(verifySolanaSignature(a.address, 'x', bad)).toBe(false);
    }
    expect(verifySolanaSignature('nope', 'x', sig)).toBe(false);
  });
});

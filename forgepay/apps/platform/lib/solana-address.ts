/**
 * Solana account addresses and ed25519 message signatures, with no dependency beyond Node's crypto.
 *
 * An account is a 32-byte ed25519 public key written in base58. A wallet's "sign message" returns a 64-byte ed25519 signature over
 * the exact bytes given, which the console receives as base64. Verification is plain ed25519, so it needs no Solana library.
 */

import { createPublicKey, verify } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BODY = /^[1-9A-HJ-NP-Za-km-z]+$/;
// DER prefix that turns a raw 32-byte ed25519 public key into an SPKI structure Node can import.
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function base58Decode(text: string): Uint8Array | null {
  if (!BODY.test(text)) return null;
  let n = 0n;
  for (const c of text) n = n * 58n + BigInt(ALPHABET.indexOf(c));
  const bytes: number[] = [];
  while (n > 0n) { bytes.push(Number(n & 0xffn)); n >>= 8n; }
  let zeros = 0;
  for (const c of text) { if (c === '1') zeros += 1; else break; }
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes.reverse()]);
}

/** A base58 string that decodes to exactly 32 bytes. Case-sensitive: never normalise it. */
export function isSolanaAddress(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 32 && value.length <= 44 && base58Decode(value)?.length === 32;
}

/** 64 bytes as base64 (88 characters ending "=="), the form the console receives from the browser. */
export const SOLANA_SIGNATURE_SHAPE = /^[A-Za-z0-9+/]{86}==$/;

/** True only if `signatureBase64` is the key's ed25519 signature over exactly `message` (UTF-8). Never throws. */
export function verifySolanaSignature(address: string, message: string, signatureBase64: string): boolean {
  try {
    const raw = base58Decode(address);
    const sig = Buffer.from(signatureBase64, 'base64');
    if (!raw || raw.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(raw)]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(message, 'utf8'), key, sig);
  } catch {
    return false;
  }
}

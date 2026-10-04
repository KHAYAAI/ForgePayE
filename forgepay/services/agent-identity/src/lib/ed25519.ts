import { createPublicKey, verify } from 'crypto';

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Verify an Ed25519 signature. The public key may be the raw 32 bytes (64 hex) or SPKI DER (hex); the signature is hex. */
export function verifyEd25519(publicKeyHex: string, message: string, signatureHex: string): boolean {
  const raw = Buffer.from(publicKeyHex, 'hex');
  const der = raw.length === 32 ? Buffer.concat([SPKI_PREFIX, raw]) : raw;
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('not an Ed25519 key');
  return verify(null, Buffer.from(message), key, Buffer.from(signatureHex, 'hex'));
}

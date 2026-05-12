/**
 * AES-256-GCM encryption utilities for storing Plaid access tokens and
 * Open Banking consent IDs at rest.
 *
 * Format of the ciphertext string (all base64url encoded, separated by '.'):
 *   <iv>.<authTag>.<ciphertext>
 *
 * The ENCRYPTION_KEY env var must be a 64-character hex string (32 bytes).
 * Generate one with: openssl rand -hex 32
 *
 * GCM is chosen over CBC because it provides both confidentiality AND
 * authenticity — if the ciphertext is tampered the decrypt will throw
 * before any plaintext is returned.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES   = 12;   // 96-bit IV recommended for GCM
const TAG_BYTES  = 16;   // 128-bit auth tag

/**
 * Derive a 32-byte key buffer from the ENCRYPTION_KEY env var.
 * Accepts a raw 64-char hex string (preferred) or falls back to hashing
 * an arbitrary string — the hex path is always recommended for production.
 */
function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? '';
  if (!raw) {
    throw new Error('ENCRYPTION_KEY env var is not set');
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  // Fallback: SHA-256 of the raw string so any non-empty value still works
  // (not recommended for production — use a 64-char hex key)
  return createHash('sha256').update(raw).digest();
}

/**
 * Encrypt `plaintext` using AES-256-GCM.
 * Returns a dot-separated base64url string: <iv>.<tag>.<ciphertext>
 */
export function encrypt(plaintext: string): string {
  const key    = getKey();
  const iv     = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const encode = (b: Buffer) => b.toString('base64url');
  return `${encode(iv)}.${encode(tag)}.${encode(encrypted)}`;
}

/**
 * Decrypt a value produced by `encrypt()`.
 * Throws if the ciphertext format is invalid or if authentication fails
 * (i.e. the value was tampered with or the key is wrong).
 */
export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format — expected <iv>.<tag>.<data>');
  }

  const [ivB64, tagB64, dataB64] = parts;
  const key     = getKey();
  const iv      = Buffer.from(ivB64,   'base64url');
  const tag     = Buffer.from(tagB64,  'base64url');
  const data    = Buffer.from(dataB64, 'base64url');

  if (iv.length !== IV_BYTES) {
    throw new Error('Invalid IV length in ciphertext');
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error('Invalid auth tag length in ciphertext');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString('utf8');
}

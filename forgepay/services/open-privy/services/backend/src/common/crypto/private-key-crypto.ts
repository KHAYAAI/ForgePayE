/**
 * Encryption for custodial wallet private keys.
 *
 * Replaces an inline block in wallet.service.ts that had three separate
 * problems, any one of which would be disqualifying for custodial key material:
 *
 *   1. `process.env.ENCRYPTION_KEY || 'dev-secret-key'` — if the variable was
 *      unset in production, every wallet private key in the database was
 *      encrypted under a key published in this repository.
 *   2. `Buffer.from(key.padEnd(32).substring(0, 32))` — the secret was
 *      space-padded to reach 32 bytes rather than derived. 'dev-secret-key'
 *      became 14 bytes of known text followed by 18 spaces: nowhere near
 *      256 bits of entropy, regardless of what the variable contained.
 *   3. AES-256-CBC with no authentication tag — ciphertext was malleable, so
 *      an attacker with write access to the column could tamper undetectably.
 *
 * This module fails closed without a real secret, derives a key with scrypt,
 * and uses AES-256-GCM so tampering is detected on decrypt.
 *
 * ⚠️ Application-level encryption is a floor, not a ceiling. Production
 * custody should hold key material in KMS or an HSM so the plaintext never
 * exists in the application process at all — see forge-custody, which already
 * does threshold signing. This module secures the interim path.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Marks the authenticated format so legacy ciphertext stays decryptable. */
const VERSION = 'v2';

const KEY_LENGTH = 32;   // AES-256
const IV_LENGTH = 12;    // GCM standard nonce
const SALT_LENGTH = 16;
const MIN_SECRET_LENGTH = 32;

/** Development-only fallback, refused in production. */
const DEV_FALLBACK = 'dev-secret-key';

/**
 * Resolve the master encryption secret.
 *
 * @throws in production when ENCRYPTION_KEY is missing, too short, or still the
 *         development fallback. Refusing to start beats silently encrypting
 *         customer key material under a guessable secret.
 */
export function getEncryptionSecret(): string {
  const secret = process.env.ENCRYPTION_KEY;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (!secret) {
      throw new Error(
        'ENCRYPTION_KEY is not set. Wallet private keys cannot be encrypted ' +
        'without it. Generate one with `openssl rand -hex 32` and supply it ' +
        'via Vault or AWS Secrets Manager.',
      );
    }
    if (secret === DEV_FALLBACK) {
      throw new Error(
        'ENCRYPTION_KEY is set to the development fallback. This value is ' +
        'public in the repository and must never protect real key material.',
      );
    }
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `ENCRYPTION_KEY must be at least ${MIN_SECRET_LENGTH} characters in ` +
        `production (got ${secret.length}).`,
      );
    }
    return secret;
  }

  return secret || DEV_FALLBACK;
}

/**
 * Derive a 32-byte key from the master secret and a per-record salt.
 *
 * A fresh salt per wallet means two wallets never share a derived key, so
 * compromising one record's key does not compromise the rest.
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH);
}

/**
 * Encrypt a private key.
 *
 * @returns `v2:<salt>:<iv>:<authTag>:<ciphertext>`, all hex.
 */
export function encryptPrivateKey(plaintext: string): string {
  if (!plaintext) throw new Error('Refusing to encrypt an empty private key.');

  const secret = getEncryptionSecret();
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(secret, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

/**
 * Decrypt a private key, accepting both the authenticated v2 format and the
 * legacy unauthenticated `<iv>:<ciphertext>` CBC format so rows written before
 * this change remain readable.
 *
 * @throws if a v2 payload has been tampered with (GCM tag mismatch).
 */
export function decryptPrivateKey(payload: string): string {
  if (!payload) throw new Error('Refusing to decrypt an empty payload.');

  const parts = payload.split(':');
  const secret = getEncryptionSecret();

  if (parts[0] === VERSION) {
    const [, saltHex, ivHex, tagHex, dataHex] = parts;
    if (!saltHex || !ivHex || !tagHex || !dataHex) {
      throw new Error('Malformed v2 encrypted private key.');
    }

    const key = deriveKey(secret, Buffer.from(saltHex, 'hex'));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  // ── Legacy path: unauthenticated AES-256-CBC with a space-padded key ───────
  // Kept only so existing rows can be read and re-encrypted. Anything read
  // through here should be written back with encryptPrivateKey immediately.
  if (parts.length === 2) {
    const [ivHex, dataHex] = parts;
    const legacyKey = Buffer.from(secret.padEnd(32).substring(0, 32));
    const decipher = createDecipheriv('aes-256-cbc', legacyKey, Buffer.from(ivHex, 'hex'));
    return decipher.update(dataHex, 'hex', 'utf8') + decipher.final('utf8');
  }

  throw new Error('Unrecognised encrypted private key format.');
}

/** True if a stored payload still uses the legacy unauthenticated format. */
export function needsReEncryption(payload: string): boolean {
  return !payload.startsWith(`${VERSION}:`);
}

/** Constant-time comparison helper for callers verifying derived material. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

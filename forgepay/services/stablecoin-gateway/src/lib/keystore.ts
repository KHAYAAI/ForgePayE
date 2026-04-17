/**
 * AES-256-GCM envelope encryption for EVM deposit private keys.
 *
 * PRIVATE_KEY_ENCRYPTION_KEY must be a 64-char hex string (32 bytes).
 * Generate one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Store it in: Kubernetes Secret / AWS Secrets Manager — never in source code.
 *
 * In production, replace this with KMS envelope encryption:
 *   1. Call KMS GenerateDataKey to get a data key + encrypted data key
 *   2. Encrypt the private key with the plaintext data key (AES-GCM)
 *   3. Store the encrypted private key + encrypted data key in the DB
 *   4. On decrypt: call KMS Decrypt to recover data key, then AES-GCM decrypt
 *
 * NOTE: GCM auth tag guarantees integrity — any tampering with the ciphertext
 *   or the IV will cause decryption to throw, not silently return garbage.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO    = 'aes-256-gcm';
const IV_LEN  = 12;   // 96-bit IV — recommended for GCM
const TAG_LEN = 16;

interface EncryptedBlob {
  iv:  string;   // hex
  ct:  string;   // hex (ciphertext)
  tag: string;   // hex (GCM auth tag)
}

function getEncryptionKey(): Buffer {
  const raw = process.env['PRIVATE_KEY_ENCRYPTION_KEY'] ?? '';
  if (raw.length === 64) {
    return Buffer.from(raw, 'hex');
  }
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'PRIVATE_KEY_ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes) in production.',
    );
  }
  // Dev-only fallback — never use for real funds
  console.warn(
    '[keystore] PRIVATE_KEY_ENCRYPTION_KEY not set — using insecure dev key. ' +
    'Set this env var before handling real funds.',
  );
  return Buffer.alloc(32, 0xde);
}

export function encryptPrivateKey(privateKey: string): string {
  const key    = getEncryptionKey();
  const iv     = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  const ct     = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  const blob: EncryptedBlob = {
    iv:  iv.toString('hex'),
    ct:  ct.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
  return JSON.stringify(blob);
}

export function decryptPrivateKey(encrypted: string): string {
  const key     = getEncryptionKey();
  const blob    = JSON.parse(encrypted) as EncryptedBlob;
  const decipher = createDecipheriv(ALGO, key, Buffer.from(blob.iv, 'hex'), { authTagLength: TAG_LEN });
  decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(blob.ct, 'hex')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

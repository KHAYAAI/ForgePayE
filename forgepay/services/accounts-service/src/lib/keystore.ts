/**
 * AES-256-GCM envelope encryption for private keys and sensitive data.
 *
 * PRIVATE_KEY_ENCRYPTION_KEY must be a 64-char hex string (32 bytes).
 * Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Store in: Kubernetes Secret / AWS Secrets Manager — never in source code.
 *
 * Production upgrade path: replace with KMS envelope encryption
 *   1. Call KMS GenerateDataKey to get plaintext + encrypted data key
 *   2. Encrypt the secret with the plaintext data key (AES-GCM)
 *   3. Store ciphertext + encrypted data key in DB
 *   4. On decrypt: KMS Decrypt → recover data key → AES-GCM decrypt
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const ALGO    = 'aes-256-gcm';
const IV_LEN  = 12;
const TAG_LEN = 16;

interface EncryptedBlob {
  iv:  string;
  ct:  string;
  tag: string;
}

function getEncryptionKey(): Buffer {
  const raw = config.encryptionKey;
  if (raw.length === 64) {
    return Buffer.from(raw, 'hex');
  }
  if (config.env === 'production') {
    throw new Error('PRIVATE_KEY_ENCRYPTION_KEY must be a 64-char hex string in production.');
  }
  console.warn('[keystore] PRIVATE_KEY_ENCRYPTION_KEY not set — using insecure dev key. Never use for real funds.');
  return Buffer.alloc(32, 0xde);
}

export function encryptPrivateKey(secret: string): string {
  const key    = getEncryptionKey();
  const iv     = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  const ct     = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const blob: EncryptedBlob = {
    iv:  iv.toString('hex'),
    ct:  ct.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
  return JSON.stringify(blob);
}

export function decryptPrivateKey(encrypted: string): string {
  const key      = getEncryptionKey();
  const blob     = JSON.parse(encrypted) as EncryptedBlob;
  const decipher = createDecipheriv(ALGO, key, Buffer.from(blob.iv, 'hex'), { authTagLength: TAG_LEN });
  decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(blob.ct, 'hex')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

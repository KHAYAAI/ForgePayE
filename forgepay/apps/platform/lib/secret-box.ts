import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { getJwtSecret } from './jwt-secret';

/**
 * Encrypts small secrets at rest (TOTP seeds). Key: TOTP_ENCRYPTION_KEY (64 hex chars) if set; otherwise
 * derived from the JWT secret with a distinct label, so a copy of the database alone does not reveal
 * anyone's second factor. Values are tagged "enc1:"; an untagged value is a legacy plaintext seed and is
 * read as is (it is re-encrypted the next time it is written).
 */
function key(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return Buffer.from(hkdfSync('sha256', getJwtSecret(), 'forgepay-console', 'totp-secret-at-rest', 32));
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return 'enc1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function openSecret(stored: string): string {
  if (!stored.startsWith('enc1:')) return stored;
  const b = Buffer.from(stored.slice(5), 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

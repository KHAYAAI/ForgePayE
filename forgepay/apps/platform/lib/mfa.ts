import { randomBytes, createHash } from 'node:crypto';
import { generateSecret, generate, verify, generateURI } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = 'ForgePay';
const BACKUP_CODE_COUNT = 10;

/** A fresh Base32 TOTP secret, Google/1Password/Authy compatible. */
export function generateTotpSecret(): string {
  return generateSecret();
}

/** otpauth:// URI for the enrollment QR code. */
export function buildTotpUri(email: string, secret: string): string {
  return generateURI({ issuer: ISSUER, label: email, secret });
}

/** QR code as a data: URL, ready for an <img src>. */
export async function totpQrCodeDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}

/** Only used during enrollment (generating a fresh code to display). Never needed for verification. */
export async function currentTotpCode(secret: string): Promise<string> {
  return generate({ secret });
}

/**
 * Verify a 6-digit code against a secret, tolerating one 30s step of clock
 * drift either side (the otplib default).
 */
export async function verifyTotpCode(secret: string, token: string): Promise<boolean> {
  if (!/^\d{6}$/.test(token)) return false;
  try {
    const result = await verify({ secret, token });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Generate a fresh set of one-time backup codes.
 *
 * @returns `{ raw, hashed }` — `raw` is shown to the user exactly once at
 *          enrollment time and never persisted; `hashed` (sha256 hex) is
 *          what gets stored in users.totp_backup_codes.
 */
export function generateBackupCodes(): { raw: string[]; hashed: string[] } {
  const raw = Array.from({ length: BACKUP_CODE_COUNT }, () =>
    randomBytes(5).toString('hex') // 10 hex chars, e.g. "a1b2c3d4e5"
  );
  return { raw, hashed: raw.map(hashBackupCode) };
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}

/**
 * Check a presented backup code against the user's remaining hashed codes.
 *
 * @returns the remaining code list with the matched code removed (so the
 *          caller can persist it — each code is single-use), or `null` if
 *          the code didn't match any stored hash.
 */
export function consumeBackupCode(
  presented: string,
  storedHashes: string[],
): string[] | null {
  const hash = hashBackupCode(presented);
  const idx = storedHashes.indexOf(hash);
  if (idx === -1) return null;
  return [...storedHashes.slice(0, idx), ...storedHashes.slice(idx + 1)];
}

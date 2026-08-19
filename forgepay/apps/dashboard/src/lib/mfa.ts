import { randomBytes, createHash } from 'node:crypto';
import { generateSecret, generate, verify, generateURI } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = 'ForgePay';
const BACKUP_CODE_COUNT = 10;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildTotpUri(email: string, secret: string): string {
  return generateURI({ issuer: ISSUER, label: email, secret });
}

export async function totpQrCodeDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}

export async function currentTotpCode(secret: string): Promise<string> {
  return generate({ secret });
}

export async function verifyTotpCode(secret: string, token: string): Promise<boolean> {
  if (!/^\d{6}$/.test(token)) return false;
  try {
    const result = await verify({ secret, token });
    return result.valid;
  } catch {
    return false;
  }
}

export function generateBackupCodes(): { raw: string[]; hashed: string[] } {
  const raw = Array.from({ length: BACKUP_CODE_COUNT }, () =>
    randomBytes(5).toString('hex')
  );
  return { raw, hashed: raw.map(hashBackupCode) };
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}

export function consumeBackupCode(
  presented: string,
  storedHashes: string[],
): string[] | null {
  const hash = hashBackupCode(presented);
  const idx = storedHashes.indexOf(hash);
  if (idx === -1) return null;
  return [...storedHashes.slice(0, idx), ...storedHashes.slice(idx + 1)];
}

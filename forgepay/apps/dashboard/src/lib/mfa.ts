import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { queryOne, execute } from './db';

/**
 * Backup codes — the one piece of MFA that stays local.
 *
 * TOTP itself moved to WorkOS (lib/workos-mfa.ts), which custodies the shared
 * secret. WorkOS has no backup-code primitive though, and a merchant who
 * loses their authenticator device needs some self-service way back in that
 * isn't "email support and prove who you are", so these live here.
 *
 * Only sha256 hashes are persisted; the raw codes are shown exactly once, at
 * enrollment. Each is single-use and is removed from the stored array as it
 * is consumed.
 */

const BACKUP_CODE_COUNT = 10;

/**
 * @returns `{ raw, hashed }` — `raw` is displayed once and never persisted;
 *          `hashed` is what goes into merchants.totp_backup_codes.
 */
export function generateBackupCodes(): { raw: string[]; hashed: string[] } {
  const raw = Array.from({ length: BACKUP_CODE_COUNT }, () =>
    randomBytes(5).toString('hex'), // 10 hex chars, e.g. "a1b2c3d4e5"
  );
  return { raw, hashed: raw.map(hashBackupCode) };
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}

/** Persist a freshly generated set, replacing any previous one. */
export async function storeBackupCodes(merchantId: string, hashed: string[]): Promise<void> {
  await execute(
    `UPDATE merchants SET totp_backup_codes = $1, updated_at = NOW() WHERE id = $2`,
    [hashed, merchantId],
  );
}

/**
 * Redeem a backup code: constant-time compare against each stored hash, and
 * on a match remove that one code so it cannot be replayed.
 *
 * @returns true if the code was valid and has now been consumed.
 */
export async function consumeBackupCode(merchantId: string, presented: string): Promise<boolean> {
  const row = await queryOne<{ totp_backup_codes: string[] }>(
    `SELECT totp_backup_codes FROM merchants WHERE id = $1`,
    [merchantId],
  );
  const stored = row?.totp_backup_codes ?? [];
  if (stored.length === 0) return false;

  const presentedHash = hashBackupCode(presented);
  const idx = stored.findIndex((candidate) => safeEqualHex(candidate, presentedHash));
  if (idx === -1) return false;

  const remaining = [...stored.slice(0, idx), ...stored.slice(idx + 1)];
  await execute(
    `UPDATE merchants SET totp_backup_codes = $1, updated_at = NOW() WHERE id = $2`,
    [remaining, merchantId],
  );
  return true;
}

/** How many unused codes remain — surfaced in settings so a merchant can regenerate before running out. */
export async function remainingBackupCodeCount(merchantId: string): Promise<number> {
  const row = await queryOne<{ totp_backup_codes: string[] }>(
    `SELECT totp_backup_codes FROM merchants WHERE id = $1`,
    [merchantId],
  );
  return row?.totp_backup_codes?.length ?? 0;
}

/** Length-safe constant-time hex comparison — avoids leaking a match via timing. */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

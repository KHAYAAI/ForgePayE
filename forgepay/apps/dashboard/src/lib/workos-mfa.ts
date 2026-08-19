import { getWorkOS } from './workos';
import { queryOne, execute } from './db';

/**
 * Merchant MFA, custodied by WorkOS.
 *
 * The earlier implementation of this app's MFA generated TOTP secrets locally
 * (otplib) and stored them in `merchants.totp_secret` — a shared secret at
 * rest in our own database, where a read of the merchants table is enough to
 * mint valid codes for every merchant at once. WorkOS's MFA API holds the
 * secret instead: we store only an opaque factor id, and verification is a
 * round-trip WorkOS answers. A dump of our database no longer yields anyone's
 * second factor.
 *
 * Flow:
 *   enroll   → WorkOS mints a factor + QR; we persist the factor id, but
 *              `mfa_enabled` stays false until a code is confirmed
 *   confirm  → first successful challenge flips mfa_enabled to true
 *   login    → password check passes, then a challenge must be verified
 *              before a session is issued (see lib/auth.ts)
 *   disable  → factor deleted at WorkOS, id cleared here
 *
 * Backup codes remain local (lib/mfa.ts's hashed, single-use codes): WorkOS
 * has no backup-code primitive, and a merchant locked out of their
 * authenticator otherwise has no self-service way back in.
 */

const ISSUER = 'ForgePay';

export interface EnrolledFactor {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
}

export interface MerchantMfaState {
  factorId: string | null;
  enabled: boolean;
}

/** Enroll a new TOTP factor with WorkOS and stage it against the merchant (not yet enabled). */
export async function enrollTotpFactor(merchantId: string, email: string): Promise<EnrolledFactor> {
  const factor = await getWorkOS().multiFactorAuth.enrollFactor({
    type: 'totp',
    issuer: ISSUER,
    user: email,
  });

  if (!factor.totp) {
    throw new Error('WorkOS returned a factor without TOTP details');
  }

  // Staged, not enabled — a factor nobody has proven they can use must never
  // be able to lock a merchant out, so mfa_enabled flips only in confirmEnrollment().
  await execute(
    `UPDATE merchants SET workos_factor_id = $1, mfa_enabled = false, updated_at = NOW() WHERE id = $2`,
    [factor.id, merchantId],
  );

  return {
    factorId: factor.id,
    qrCode: factor.totp.qrCode,
    secret: factor.totp.secret,
    uri: factor.totp.uri,
  };
}

/** Current MFA state for a merchant. */
export async function getMerchantMfaState(merchantId: string): Promise<MerchantMfaState> {
  const row = await queryOne<{ workos_factor_id: string | null; mfa_enabled: boolean }>(
    `SELECT workos_factor_id, mfa_enabled FROM merchants WHERE id = $1`,
    [merchantId],
  );
  return {
    factorId: row?.workos_factor_id ?? null,
    enabled: row?.mfa_enabled ?? false,
  };
}

/** Same lookup by email — the login path knows the email before it knows the merchant id. */
export async function getMerchantMfaStateByEmail(email: string): Promise<MerchantMfaState> {
  const row = await queryOne<{ workos_factor_id: string | null; mfa_enabled: boolean }>(
    `SELECT workos_factor_id, mfa_enabled FROM merchants WHERE email = $1`,
    [email],
  );
  return {
    factorId: row?.workos_factor_id ?? null,
    enabled: row?.mfa_enabled ?? false,
  };
}

/**
 * Verify a 6-digit code against a factor by opening a challenge and answering
 * it in one step. Returns false (never throws) on a bad code, so callers can
 * treat it as a plain predicate; genuine transport/config failures still throw.
 */
export async function verifyTotpCode(factorId: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;

  const workos = getWorkOS();
  const challenge = await workos.multiFactorAuth.challengeFactor({
    authenticationFactorId: factorId,
  });

  try {
    const { valid } = await workos.multiFactorAuth.verifyChallenge({
      authenticationChallengeId: challenge.id,
      code,
    });
    return valid;
  } catch (err) {
    // WorkOS answers 422 for a wrong/expired code — a failed check, not a fault.
    if (isUnprocessable(err)) return false;
    throw err;
  }
}

/**
 * Confirm a staged enrollment: verify one code, and only then turn MFA on.
 * Returns false if the code didn't check out (enrollment stays staged).
 */
export async function confirmEnrollment(merchantId: string, code: string): Promise<boolean> {
  const { factorId } = await getMerchantMfaState(merchantId);
  if (!factorId) return false;

  const valid = await verifyTotpCode(factorId, code);
  if (!valid) return false;

  await execute(
    `UPDATE merchants SET mfa_enabled = true, updated_at = NOW() WHERE id = $1`,
    [merchantId],
  );
  return true;
}

/** Turn MFA off and delete the factor at WorkOS. Best-effort on the remote delete — local state is authoritative for access. */
export async function disableMfa(merchantId: string): Promise<void> {
  const { factorId } = await getMerchantMfaState(merchantId);

  await execute(
    `UPDATE merchants
        SET mfa_enabled = false, workos_factor_id = NULL, totp_backup_codes = '{}', updated_at = NOW()
      WHERE id = $1`,
    [merchantId],
  );

  if (factorId) {
    try {
      await getWorkOS().multiFactorAuth.deleteFactor(factorId);
    } catch (err) {
      // The merchant is already un-gated locally; a stranded WorkOS factor is
      // inert, so this must not fail the request.
      console.error('[mfa] failed to delete WorkOS factor (local state already cleared):', err);
    }
  }
}

function isUnprocessable(err: unknown): boolean {
  const status = (err as { status?: number; code?: number })?.status ?? (err as { code?: number })?.code;
  return status === 422 || status === 400;
}

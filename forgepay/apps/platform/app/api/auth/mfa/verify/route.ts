import { NextRequest, NextResponse } from 'next/server';
import { hit } from '@/lib/rate-limit';
import { openSecret } from '@/lib/secret-box';
import { z } from 'zod';
import {
  getMfaPendingToken,
  verifyMfaPendingToken,
  clearMfaPendingCookie,
  getUserById,
  createSession,
  setAuthCookie,
  replaceBackupCodeHashes,
} from '@/lib/auth';
import { verifyTotpCode, consumeBackupCode } from '@/lib/mfa';
import { logAuditEvent, clientIp } from '@/lib/audit';

const bodySchema = z.object({ code: z.string().min(6).max(10) });

/** Second step of login for accounts with MFA enabled — exchanges the mfa-pending cookie plus a TOTP/backup code for a real session. */
export async function POST(req: NextRequest) {
  const ipAddress = clientIp(req);
  const userAgent = req.headers.get('user-agent');

  const pendingToken = await getMfaPendingToken();
  if (!pendingToken) {
    return NextResponse.json({ error: 'No pending login. Sign in again.' }, { status: 401 });
  }
  const pending = verifyMfaPendingToken(pendingToken);
  if (!pending) {
    await clearMfaPendingCookie();
    return NextResponse.json({ error: 'Login session expired. Sign in again.' }, { status: 401 });
  }

  let code: string;
  try {
    ({ code } = bodySchema.parse(await req.json()));
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const user = await getUserById(pending.userId);
  if (!user || !user.totp_enabled || !user.totp_secret) {
    await clearMfaPendingCookie();
    return NextResponse.json({ error: 'MFA is not enabled on this account.' }, { status: 400 });
  }

  // A 6-digit code has a million possibilities: without a limit it can simply be guessed.
  const attempts = await hit(`mfa:${user.id}`, 6, 10 * 60_000);
  if (!attempts.allowed) {
    await clearMfaPendingCookie();
    return NextResponse.json({ error: 'Too many attempts. Sign in again later.' }, { status: 429, headers: { 'retry-after': String(attempts.retryAfterSec) } });
  }

  const isTotpCode = /^\d{6}$/.test(code);
  let ok = false;

  if (isTotpCode) {
    ok = await verifyTotpCode(openSecret(user.totp_secret), code);
  } else {
    const remaining = consumeBackupCode(code, user.totp_backup_codes);
    if (remaining) {
      ok = true;
      await replaceBackupCodeHashes(user.id, remaining);
    }
  }

  if (!ok) {
    await logAuditEvent({
      tenantId: user.tenant_id, actorUserId: user.id, actorEmail: user.email,
      action: 'mfa.challenge_failed', ipAddress, userAgent,
    });
    return NextResponse.json({ error: 'Invalid code.' }, { status: 401 });
  }

  await clearMfaPendingCookie();

  const { token } = await createSession(
    { userId: user.id, email: user.email, tenantId: user.tenant_id, role: user.role ?? 'analyst' },
    { ipAddress, userAgent },
  );
  await setAuthCookie(token);

  await logAuditEvent({
    tenantId: user.tenant_id, actorUserId: user.id, actorEmail: user.email,
    action: 'auth.login_success', detail: { mfa: isTotpCode ? 'totp' : 'backup_code' },
    ipAddress, userAgent,
  });

  return NextResponse.json({
    success: true,
    user: { id: user.id, email: user.email, name: user.name, tenantId: user.tenant_id },
  });
}

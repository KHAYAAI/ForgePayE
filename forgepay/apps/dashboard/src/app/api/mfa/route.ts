import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getMerchantMfaState, disableMfa, verifyTotpCode } from '@/lib/workos-mfa';
import { consumeBackupCode, remainingBackupCodeCount } from '@/lib/mfa';
import { WorkOsNotConfiguredError, isWorkOsConfigured } from '@/lib/workos';
import { logAuditEvent, clientIp } from '@/lib/audit';

/** Current MFA state — drives the settings panel. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const state = await getMerchantMfaState(session.user.id);
  return NextResponse.json({
    enabled:              state.enabled,
    enrollmentStaged:     !!state.factorId && !state.enabled,
    backupCodesRemaining: await remainingBackupCodeCount(session.user.id),
    available:            isWorkOsConfigured(),
  });
}

/**
 * Turn MFA off. Requires a current code (or a backup code) — a hijacked
 * session must not be able to strip the second factor with a bare POST,
 * which is the whole point of having one.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let code: string | undefined;
  let backupCode: string | undefined;
  try {
    ({ code, backupCode } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const state = await getMerchantMfaState(session.user.id);
    if (!state.enabled) {
      return NextResponse.json({ error: 'MFA is not enabled' }, { status: 409 });
    }

    const proved = backupCode
      ? await consumeBackupCode(session.user.id, backupCode)
      : code && state.factorId
        ? await verifyTotpCode(state.factorId, code)
        : false;

    if (!proved) {
      await logAuditEvent({
        merchantId:      session.user.id,
        actorMerchantId: session.user.id,
        actorEmail:      session.user.email,
        action:          'mfa.challenge_failed',
        detail:          { stage: 'disable' },
        ipAddress:       clientIp(req),
        userAgent:       req.headers.get('user-agent'),
      });
      return NextResponse.json({ error: 'A valid code is required to disable MFA' }, { status: 401 });
    }

    await disableMfa(session.user.id);

    await logAuditEvent({
      merchantId:      session.user.id,
      actorMerchantId: session.user.id,
      actorEmail:      session.user.email,
      action:          'mfa.disabled',
      detail:          { via: backupCode ? 'backup_code' : 'totp' },
      ipAddress:       clientIp(req),
      userAgent:       req.headers.get('user-agent'),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WorkOsNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[mfa] disable failed:', err);
    return NextResponse.json({ error: 'Failed to disable MFA' }, { status: 500 });
  }
}

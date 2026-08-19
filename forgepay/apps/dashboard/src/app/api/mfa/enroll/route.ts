import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { enrollTotpFactor, getMerchantMfaState } from '@/lib/workos-mfa';
import { generateBackupCodes, storeBackupCodes } from '@/lib/mfa';
import { WorkOsNotConfiguredError } from '@/lib/workos';
import { logAuditEvent, clientIp } from '@/lib/audit';

/**
 * Stage a TOTP enrollment: WorkOS mints the factor and holds its secret; we
 * return the QR code once, for the merchant to scan.
 *
 * MFA is NOT on after this call — POST /api/mfa/verify-enrollment must confirm
 * a real code first, so a merchant who scans nothing is never locked out.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Re-enrolling while MFA is already on would silently orphan the active
    // factor and invalidate the merchant's working authenticator; make them
    // disable first so the destructive step is explicit.
    const state = await getMerchantMfaState(session.user.id);
    if (state.enabled) {
      return NextResponse.json(
        { error: 'MFA is already enabled. Disable it before enrolling a new device.' },
        { status: 409 },
      );
    }

    const factor = await enrollTotpFactor(session.user.id, session.user.email);

    // Fresh backup codes accompany each enrollment, shown once alongside the QR.
    const { raw, hashed } = generateBackupCodes();
    await storeBackupCodes(session.user.id, hashed);

    return NextResponse.json({
      factorId:    factor.factorId,
      qrCode:      factor.qrCode,
      secret:      factor.secret,
      uri:         factor.uri,
      backupCodes: raw,
    });
  } catch (err) {
    if (err instanceof WorkOsNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[mfa] enrollment failed:', err);
    await logAuditEvent({
      merchantId:      session.user.id,
      actorMerchantId: session.user.id,
      actorEmail:      session.user.email,
      action:          'mfa.challenge_failed',
      detail:          { stage: 'enroll' },
      ipAddress:       clientIp(req),
      userAgent:       req.headers.get('user-agent'),
    });
    return NextResponse.json({ error: 'Failed to start MFA enrollment' }, { status: 500 });
  }
}

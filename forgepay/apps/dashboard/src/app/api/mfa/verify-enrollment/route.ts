import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { confirmEnrollment } from '@/lib/workos-mfa';
import { WorkOsNotConfiguredError } from '@/lib/workos';
import { revokeAllSessions } from '@/lib/sessions';
import { logAuditEvent, clientIp } from '@/lib/audit';

/**
 * Confirm a staged enrollment with one real code. Only this turns MFA on.
 *
 * On success every OTHER session for the merchant is revoked: turning on a
 * second factor is usually a response to "I think someone else has my
 * password", and it would mean little if a session that predates it kept
 * working untouched.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let code: string | undefined;
  try {
    ({ code } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }

  try {
    const confirmed = await confirmEnrollment(session.user.id, code);

    if (!confirmed) {
      await logAuditEvent({
        merchantId:      session.user.id,
        actorMerchantId: session.user.id,
        actorEmail:      session.user.email,
        action:          'mfa.challenge_failed',
        detail:          { stage: 'verify_enrollment' },
        ipAddress:       clientIp(req),
        userAgent:       req.headers.get('user-agent'),
      });
      return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
    }

    const currentSessionId = session.user.sessionId;
    const revoked = await revokeAllSessions(session.user.id, currentSessionId);

    await logAuditEvent({
      merchantId:      session.user.id,
      actorMerchantId: session.user.id,
      actorEmail:      session.user.email,
      action:          'mfa.enrolled',
      detail:          { otherSessionsRevoked: revoked },
      ipAddress:       clientIp(req),
      userAgent:       req.headers.get('user-agent'),
    });

    return NextResponse.json({ ok: true, otherSessionsRevoked: revoked });
  } catch (err) {
    if (err instanceof WorkOsNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[mfa] enrollment verification failed:', err);
    return NextResponse.json({ error: 'Failed to verify code' }, { status: 500 });
  }
}

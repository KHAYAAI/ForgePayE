import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, getUserById, confirmTotpEnrollment } from '@/lib/auth';
import { verifyTotpCode, generateBackupCodes } from '@/lib/mfa';
import { logAuditEvent, clientIp } from '@/lib/audit';

const bodySchema = z.object({ code: z.string().length(6) });

/** Complete MFA enrollment: proves the user's authenticator app is actually working before turning MFA on. */
export async function POST(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user || !user.totp_secret) {
    return NextResponse.json({ error: 'No enrollment in progress. Call /api/user/mfa/enroll first.' }, { status: 400 });
  }

  let code: string;
  try {
    ({ code } = bodySchema.parse(await req.json()));
  } catch {
    return NextResponse.json({ error: 'Enter the 6-digit code from your authenticator app.' }, { status: 400 });
  }

  const ok = await verifyTotpCode(user.totp_secret, code);
  if (!ok) {
    return NextResponse.json({ error: 'Incorrect code. Check the time on your device and try again.' }, { status: 400 });
  }

  const { raw, hashed } = generateBackupCodes();
  await confirmTotpEnrollment(user.id, hashed);

  await logAuditEvent({
    tenantId: user.tenant_id, actorUserId: user.id, actorEmail: user.email,
    action: 'mfa.enrolled', ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });

  // Backup codes are returned exactly once, here — only their hashes are stored.
  return NextResponse.json({ success: true, backupCodes: raw });
}

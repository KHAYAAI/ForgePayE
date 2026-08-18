import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, getUserById, verifyPassword, disableTotp } from '@/lib/auth';
import { logAuditEvent, clientIp } from '@/lib/audit';

const bodySchema = z.object({ password: z.string() });

/** Disabling MFA requires re-entering the password — an attacker with a stolen, still-valid session shouldn't be able to strip MFA on their own. */
export async function POST(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let password: string;
  try {
    ({ password } = bodySchema.parse(await req.json()));
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const passwordValid = await verifyPassword(password, user.password_hash);
  if (!passwordValid) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
  }

  await disableTotp(user.id);

  await logAuditEvent({
    tenantId: user.tenant_id, actorUserId: user.id, actorEmail: user.email,
    action: 'mfa.disabled', ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });

  return NextResponse.json({ success: true });
}

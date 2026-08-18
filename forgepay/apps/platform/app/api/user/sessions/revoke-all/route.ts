import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, revokeAllSessions } from '@/lib/auth';
import { logAuditEvent, clientIp } from '@/lib/audit';

const bodySchema = z.object({ includeCurrent: z.boolean().default(false) });

/** "Log out everywhere" — revokes every other active session by default, or truly all (including this one) if includeCurrent is set. */
export async function POST(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let includeCurrent = false;
  try {
    ({ includeCurrent } = bodySchema.parse(await req.json().catch(() => ({}))));
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const revokedCount = await revokeAllSessions(session.userId, includeCurrent ? undefined : session.jti);

  await logAuditEvent({
    tenantId: session.tenantId, actorUserId: session.userId, actorEmail: session.email,
    action: 'session.revoked_all', detail: { revokedCount, includeCurrent },
    ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });

  return NextResponse.json({ success: true, revokedCount });
}

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getSessionById, revokeSession } from '@/lib/auth';
import { logAuditEvent, clientIp } from '@/lib/audit';

/** Revoke a single session by id — signing that one device/browser out remotely. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const target = await getSessionById(params.id);
  if (!target || target.user_id !== session.userId) {
    // Same response whether the session doesn't exist or belongs to someone
    // else — a 404 on a session ID that does exist would confirm the ID is
    // real to a caller who guessed it.
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  await revokeSession(target.id);

  await logAuditEvent({
    tenantId: session.tenantId, actorUserId: session.userId, actorEmail: session.email,
    action: 'session.revoked', resource: target.id,
    detail: { self: target.id === session.jti },
    ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });

  return NextResponse.json({ success: true });
}

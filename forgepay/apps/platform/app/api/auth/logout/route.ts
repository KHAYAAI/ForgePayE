import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, clearAuthCookie, revokeSession } from '@/lib/auth';
import { logAuditEvent, clientIp } from '@/lib/audit';

/**
 * Revoke the session and clear the cookie. Revoking matters, not just
 * clearing the cookie: without it, a copy of the cookie captured before
 * logout (XSS, a shared/leaked browser profile, a proxy log) stays valid
 * for the rest of its 7-day life.
 */
async function doLogout(req: NextRequest) {
  const session = await getCurrentUser();
  if (session) {
    await revokeSession(session.jti);
    await logAuditEvent({
      tenantId: session.tenantId, actorUserId: session.userId, actorEmail: session.email,
      action: 'auth.logout', ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
    });
  }
  await clearAuthCookie();
}

export async function GET(req: NextRequest) {
  await doLogout(req);
  return NextResponse.redirect(new URL('/auth/login', req.url));
}

export async function POST(req: NextRequest) {
  await doLogout(req);
  return NextResponse.json({ success: true });
}

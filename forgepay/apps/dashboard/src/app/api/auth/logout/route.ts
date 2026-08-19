import { NextRequest, NextResponse } from 'next/server';
import { signOut } from 'next-auth/react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { revokeSession } from '@/lib/sessions';
import { logAuditEvent, clientIp } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessionId = (session.user as any).sessionId;
    if (sessionId) {
      await revokeSession(sessionId);
    }

    await logAuditEvent({
      merchantId: session.user.id,
      actorMerchantId: session.user.id,
      actorEmail: session.user.email,
      action: 'auth.logout',
      ipAddress: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[logout] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

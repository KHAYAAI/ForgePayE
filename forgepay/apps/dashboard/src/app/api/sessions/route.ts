import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listActiveSessions, revokeAllSessions } from '@/lib/sessions';
import { logAuditEvent, clientIp } from '@/lib/audit';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessions = await listActiveSessions(session.user.id);
    return NextResponse.json({ sessions });
  } catch (err) {
    console.error('[sessions] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action } = await req.json();

    if (action === 'revoke-all-except-current') {
      const currentSessionId = (session.user as any).sessionId;
      await revokeAllSessions(session.user.id, currentSessionId);

      await logAuditEvent({
        merchantId: session.user.id,
        actorMerchantId: session.user.id,
        actorEmail: session.user.email,
        action: 'session.revoked_all',
        ipAddress: clientIp(req),
        userAgent: req.headers.get('user-agent'),
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('[sessions] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

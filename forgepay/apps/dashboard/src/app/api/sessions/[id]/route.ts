import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionById, revokeSession } from '@/lib/sessions';
import { logAuditEvent, clientIp } from '@/lib/audit';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessionToRevoke = await getSessionById(params.id);
    if (!sessionToRevoke || sessionToRevoke.merchant_id !== session.user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await revokeSession(params.id);

    await logAuditEvent({
      merchantId: session.user.id,
      actorMerchantId: session.user.id,
      actorEmail: session.user.email,
      action: 'session.revoked',
      resource: params.id,
      ipAddress: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[sessions] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

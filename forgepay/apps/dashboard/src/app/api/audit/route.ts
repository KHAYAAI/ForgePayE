import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listAuditLog } from '@/lib/audit';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10);
    const before = req.nextUrl.searchParams.get('before');

    const events = await listAuditLog(session.user.id, { limit, before });
    return NextResponse.json({ events });
  } catch (err) {
    console.error('[audit] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

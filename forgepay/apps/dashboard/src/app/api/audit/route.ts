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

    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const before = req.nextUrl.searchParams.get('before') ?? undefined;

    const events = await listAuditLog(session.user.id, { limit, before });
    return NextResponse.json({ events });
  } catch (err) {
    console.error('[audit] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

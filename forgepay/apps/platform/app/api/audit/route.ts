import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { listAuditLog } from '@/lib/audit';

/** Tenant-scoped audit trail — gated behind the view:audit permission every role already has except none (analyst is the floor and already holds it). */
export async function GET(req: NextRequest) {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!can(session.role, 'view:audit')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get('limit') ?? '50');
  const before = searchParams.get('before') ?? undefined;

  const entries = await listAuditLog(session.tenantId, { limit, before });
  return NextResponse.json({ entries });
}

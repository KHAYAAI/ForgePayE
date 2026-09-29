import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { logAuditEvent, clientIp } from '@/lib/audit';
import { revokeInvitation } from '@/lib/invitations';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!can(user.role, 'manage:team')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await revokeInvitation(user.tenantId, params.id))) {
    return NextResponse.json({ error: 'No pending invitation with that id.' }, { status: 404 });
  }
  await logAuditEvent({
    tenantId: user.tenantId, actorUserId: user.userId, actorEmail: user.email, action: 'team.invite_revoked',
    resource: params.id, ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });
  return NextResponse.json({ ok: true });
}

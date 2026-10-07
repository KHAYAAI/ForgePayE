/** DELETE /api/forge/institution/keys/:keyId: revoke one of the institution's keys (never the last active one). Owners and admins only. */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { revokeKey } from '@/lib/institution-onboarding';
import { clientIp, logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: Promise<{ keyId: string }> }) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:api_keys' });
  if ('response' in g) return g.response;
  const { keyId } = await params;
  const result = await revokeKey(g.user.tenantId, keyId);
  if (result.ok === false) return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
  await logAuditEvent({
    tenantId: g.user.tenantId, actorUserId: g.user.userId, actorEmail: g.user.email, action: 'institution.key_revoked', resource: keyId,
    ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });
  return NextResponse.json({ data: result.value });
}

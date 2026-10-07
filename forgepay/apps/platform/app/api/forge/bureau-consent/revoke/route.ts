/**
 * POST /api/forge/bureau-consent/revoke  { jti }
 * Withdraw one of the workspace's own consent authorisations. Takes effect on the bureau on the next pull.
 */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { revokeConsentForWorkspace } from '@/lib/bureau-consent';
import { clientIp, logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:consent' });
  if ('response' in g) return g.response;

  const body = (await req.json().catch(() => null)) as { jti?: unknown } | null;
  if (typeof body?.jti !== 'string' || !body.jti) {
    return NextResponse.json({ error: 'ValidationError', message: 'jti is required' }, { status: 400 });
  }

  const result = await revokeConsentForWorkspace(g.user.tenantId, body.jti);
  if (result.ok === false) return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });

  await logAuditEvent({
    tenantId: g.user.tenantId, actorUserId: g.user.userId, actorEmail: g.user.email,
    action: 'bureau.consent.revoked', resource: body.jti,
    ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });
  return NextResponse.json({ data: { jti: body.jti, revoked: true } });
}

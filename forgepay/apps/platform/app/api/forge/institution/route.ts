/**
 * Institution access to the bureau API.
 *   GET   this workspace's application (or approved institution), and whether it is the operator workspace
 *   POST  apply for access (owners and admins)
 */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { apply, currentApplication, validateApplication } from '@/lib/institution-onboarding';
import { isBureauOperator } from '@/lib/bureau-scope';
import { clientIp, logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await guardRoute({ product: 'credit-bureau' });
  if ('response' in g) return g.response;
  return NextResponse.json({
    live: true,
    data: { application: await currentApplication(g.user.tenantId), isOperator: isBureauOperator(g.user.tenantId) },
  });
}

export async function POST(req: Request) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:api_keys' });
  if ('response' in g) return g.response;
  const parsed = validateApplication(await req.json().catch(() => null));
  if (parsed.ok === false) return NextResponse.json({ error: 'ValidationError', message: parsed.message }, { status: 400 });
  const result = await apply(g.user.tenantId, parsed.value);
  if (result.ok === false) return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
  await logAuditEvent({
    tenantId: g.user.tenantId, actorUserId: g.user.userId, actorEmail: g.user.email, action: 'institution.applied', resource: result.value.id,
    detail: { name: parsed.value.name, type: parsed.value.institutionType, country: parsed.value.country }, ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });
  return NextResponse.json({ data: result.value }, { status: 201 });
}

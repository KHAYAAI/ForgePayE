/**
 * POST /api/forge/institution/applications/:id   { approve: boolean, reason?, scopes?, requestsPerMinute?, maxPullsPerDay? }
 * Approve (provisions the institution on the bureau) or reject. Operator workspace owner only.
 */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { decide, getApplication, validateDecision } from '@/lib/institution-onboarding';
import { isBureauOperator } from '@/lib/bureau-scope';
import { clientIp, logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'admin:all' });
  if ('response' in g) return g.response;
  if (!isBureauOperator(g.user.tenantId)) return NextResponse.json({ error: 'Forbidden', message: 'Only the operator workspace decides applications.' }, { status: 403 });

  const { id } = await params;
  const known = await getApplication(id);
  if (!known) return NextResponse.json({ error: 'NotFound', message: 'No such application.' }, { status: 404 });
  const parsed = validateDecision(await req.json().catch(() => null), known.requested_scopes);
  if (parsed.ok === false) return NextResponse.json({ error: parsed.error, message: parsed.message }, { status: parsed.status });

  const result = await decide(g.user.tenantId, g.user.email, id, parsed.value);
  if (result.ok === false) return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });

  await logAuditEvent({
    tenantId: g.user.tenantId, actorUserId: g.user.userId, actorEmail: g.user.email,
    action: parsed.value.approve ? 'institution.approved' : 'institution.rejected', resource: id,
    detail: { applicant: known.tenant_id, name: known.name, scopes: result.value.granted_scopes, limits: { rpm: parsed.value.requestsPerMinute, pulls: parsed.value.maxPullsPerDay }, reason: parsed.value.reason },
    ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });
  return NextResponse.json({ data: result.value });
}

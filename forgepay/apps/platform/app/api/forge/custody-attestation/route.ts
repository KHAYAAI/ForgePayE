/**
 * Console data proxy: /api/forge/custody-attestation
 *
 *   GET     ?agentId=…  what the bureau holds for one of the workspace's agents (counts, expiry, the two figures it yields)
 *   POST    give the bureau a signed custody statement for one of the workspace's agents. Needs an explicit acknowledgement.
 *   DELETE  ?agentId=…  withdraw: the bureau erases it
 *
 * Needs the credit bureau enabled for the workspace and the manage:consent permission (owner or admin).
 */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { getStatement, submitStatement, validateSubmitInput, withdrawStatement } from '@/lib/custody-attestation';
import { clientIp, logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const agentIdOf = (req: Request) => (new URL(req.url).searchParams.get('agentId') ?? '').trim();

export async function GET(req: Request) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:consent' });
  if ('response' in g) return g.response;
  const agentId = agentIdOf(req);
  if (!agentId || agentId.length > 200) return NextResponse.json({ error: 'ValidationError', message: 'agentId is required' }, { status: 400 });
  const r = await getStatement(g.user.tenantId, agentId);
  if (r.ok === false) return NextResponse.json({ error: r.error, message: r.message }, { status: r.status });
  return NextResponse.json({ live: true, data: r.value });
}

export async function POST(req: Request) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:consent' });
  if ('response' in g) return g.response;

  const parsed = validateSubmitInput(await req.json().catch(() => null));
  if (parsed.ok === false) return NextResponse.json({ error: 'ValidationError', message: parsed.message }, { status: 400 });

  const r = await submitStatement(g.user.tenantId, g.user.email, parsed.value);
  if (r.ok === false) return NextResponse.json({ error: r.error, message: r.message }, { status: r.status });

  // The statement itself is not logged: who gave what to whom, and when, is.
  await logAuditEvent({
    tenantId: g.user.tenantId, actorUserId: g.user.userId, actorEmail: g.user.email,
    action: 'custody.statement.submitted', resource: parsed.value.agentId,
    detail: { custodyAgentId: r.value.custodyAgentId, issuedAt: r.value.issuedAt, expiresAt: r.value.expiresAt, ...(parsed.value.consentRef ? { consentRef: parsed.value.consentRef } : {}) },
    ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });
  return NextResponse.json({ data: r.value }, { status: 201 });
}

export async function DELETE(req: Request) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:consent' });
  if ('response' in g) return g.response;
  const agentId = agentIdOf(req);
  if (!agentId || agentId.length > 200) return NextResponse.json({ error: 'ValidationError', message: 'agentId is required' }, { status: 400 });

  const r = await withdrawStatement(g.user.tenantId, agentId);
  if (r.ok === false) return NextResponse.json({ error: r.error, message: r.message }, { status: r.status });
  await logAuditEvent({
    tenantId: g.user.tenantId, actorUserId: g.user.userId, actorEmail: g.user.email,
    action: 'custody.statement.withdrawn', resource: agentId, detail: { erased: r.value.erased },
    ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });
  return NextResponse.json({ data: r.value });
}

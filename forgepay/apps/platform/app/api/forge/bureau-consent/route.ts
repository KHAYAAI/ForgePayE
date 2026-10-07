/**
 * Console data proxy: /api/forge/bureau-consent
 *
 *   GET   the workspace's own consent authorisations
 *   POST  authorise a named lender to pull one of the workspace's agents' credit reports; returns the single-use token ONCE
 *
 * Needs the credit bureau enabled for the workspace and the manage:consent permission (owner or admin).
 */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { issueConsentForWorkspace, listConsents, validateIssueInput } from '@/lib/bureau-consent';
import { clientIp, logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:consent' });
  if ('response' in g) return g.response;
  const rows = await listConsents(g.user.tenantId);
  return NextResponse.json({ live: true, data: rows });
}

export async function POST(req: Request) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:consent' });
  if ('response' in g) return g.response;

  const parsed = validateIssueInput(await req.json().catch(() => null));
  if (parsed.ok === false) return NextResponse.json({ error: 'ValidationError', message: parsed.message }, { status: 400 });

  const result = await issueConsentForWorkspace(g.user.tenantId, g.user.email, parsed.value);
  if (result.ok === false) return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });

  // The jti identifies the authorisation; the token itself is never logged.
  await logAuditEvent({
    tenantId: g.user.tenantId, actorUserId: g.user.userId, actorEmail: g.user.email,
    action: 'bureau.consent.issued', resource: result.consent.jti,
    detail: { agentId: parsed.value.agentId, requestorId: parsed.value.requestorId, purpose: parsed.value.purpose, expiresAt: result.consent.expiresAt },
    ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });

  return NextResponse.json({
    data: {
      consentToken: result.consent.consentToken,
      jti: result.consent.jti,
      expiresAt: result.consent.expiresAt,
      scope: result.consent.scope,
      note: 'Give this token to the lender now. It is shown once, works once, and only for this agent, this lender and this purpose.',
    },
  }, { status: 201 });
}

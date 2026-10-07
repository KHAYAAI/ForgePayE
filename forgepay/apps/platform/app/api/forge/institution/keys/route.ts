/**
 * An approved institution's API keys.
 *   GET   the keys (status, last use; never key material)
 *   POST  create a key { label?, expiresInDays? }; the key is shown once
 * Owners and admins only.
 */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { issueKey, listKeys } from '@/lib/institution-onboarding';
import { clientIp, logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:api_keys' });
  if ('response' in g) return g.response;
  const result = await listKeys(g.user.tenantId);
  if (result.ok === false) return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
  return NextResponse.json({ live: true, data: result.value });
}

export async function POST(req: Request) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:api_keys' });
  if ('response' in g) return g.response;
  const body = ((await req.json().catch(() => null)) ?? {}) as { label?: unknown; expiresInDays?: unknown };
  const result = await issueKey(g.user.tenantId, body);
  if (result.ok === false) return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
  await logAuditEvent({
    tenantId: g.user.tenantId, actorUserId: g.user.userId, actorEmail: g.user.email, action: 'institution.key_issued', resource: result.value.key.id,
    detail: { institutionId: result.value.institutionId, label: result.value.key.label, expiresAt: result.value.key.expiresAt }, ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });
  return NextResponse.json({
    data: { key: result.value.key, apiKey: result.value.apiKey, institutionId: result.value.institutionId, note: 'Store this key now. It cannot be shown again.' },
  }, { status: 201 });
}

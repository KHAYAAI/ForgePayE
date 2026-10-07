/** GET /api/forge/institution/applications: the queue of applications. Operator workspace only. */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { listApplications } from '@/lib/institution-onboarding';
import { isBureauOperator } from '@/lib/bureau-scope';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'admin:all' });
  if ('response' in g) return g.response;
  if (!isBureauOperator(g.user.tenantId)) return NextResponse.json({ error: 'Forbidden', message: 'Only the operator workspace sees the queue.' }, { status: 403 });
  const status = new URL(req.url).searchParams.get('status') ?? undefined;
  return NextResponse.json({ live: true, data: await listApplications(status) });
}

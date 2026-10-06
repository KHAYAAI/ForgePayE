/**
 * Console data proxy — PUT /api/forge/bureau-disputes/:id
 *
 * Advances or resolves one dispute. A write, called once per action from the
 * Disputes page — never polled. Resolving a dispute is the bureau's job as
 * the data holder, so only FORGE's operator workspace may do it.
 */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { putBureauDispute } from '@/lib/forge-services';
import { isBureauOperator } from '@/lib/bureau-scope';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:billing' });
  if ('response' in g) return g.response;
  if (!isBureauOperator(g.user.tenantId)) {
    return NextResponse.json({ live: false, data: null, error: 'only the FORGE operator workspace resolves disputes' }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { status?: string; resolution?: string } | null;
  if (!body?.status) {
    return NextResponse.json({ live: false, data: null, error: 'missing status' }, { status: 400 });
  }
  return NextResponse.json(await putBureauDispute((await params).id, { status: body.status, resolution: body.resolution }));
}

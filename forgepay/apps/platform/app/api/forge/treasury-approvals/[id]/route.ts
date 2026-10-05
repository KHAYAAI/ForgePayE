/**
 * Console proxy — POST /api/forge/treasury-approvals/:id
 *
 * Approves or rejects one treasury approval. The approval desk's button used
 * to change only local React state, so an "approved" item was never approved
 * anywhere. This resolves it in enterprise-treasury, recorded against the
 * signed-in user.
 */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { resolveTreasuryApproval } from '@/lib/forge-services';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await guardRoute({ product: 'treasury', permission: 'manage:billing' });
  if ('response' in g) return g.response;
  const body = (await req.json().catch(() => null)) as { approved?: boolean } | null;
  if (typeof body?.approved !== 'boolean') {
    return NextResponse.json({ live: false, data: null, error: 'approved (boolean) is required' }, { status: 400 });
  }
  const result = await resolveTreasuryApproval(params.id, body.approved, g.user.email);
  return NextResponse.json(result, { status: result.live ? 200 : 502 });
}

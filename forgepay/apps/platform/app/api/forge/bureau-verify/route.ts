/**
 * Console data proxy — POST /api/forge/bureau-verify
 *
 * Runs the bureau's 8-check verification for one agent. A write (it's a
 * metered pull on the bureau side), so unlike the GET /api/forge/:section
 * sections this is never polled — the Verify page calls it once per click.
 */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { postBureauVerify } from '@/lib/forge-services';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:billing' });
  if ('response' in g) return g.response;
  const body = (await req.json().catch(() => null)) as { agentId?: string } | null;
  if (!body?.agentId) {
    return NextResponse.json({ live: false, data: null, error: 'missing agentId' }, { status: 400 });
  }
  return NextResponse.json(await postBureauVerify(body.agentId));
}

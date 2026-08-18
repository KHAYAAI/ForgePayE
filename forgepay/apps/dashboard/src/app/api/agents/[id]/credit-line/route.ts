/**
 * GET /api/agents/[id]/credit-line — Get credit line for agent
 */

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const merchantId = (session.user as any).merchantId || 'merchant-default';

  try {
    const baseUrl = process.env.AGENT_CREDIT_LINES_URL || 'http://localhost:3016';
    const res = await fetch(`${baseUrl}/v1/agents/${params.id}/credit-line`, {
      headers: { 'x-merchant-id': merchantId },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await res.json();
    return NextResponse.json(body.data ?? {});
  } catch (err) {
    console.error('[credit-line] fetch error:', err);
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
}

/**
 * GET /api/agents/[id]/decisions — Get recent decisions for agent
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
  const limit = req.nextUrl.searchParams.get('limit') || '10';

  try {
    const baseUrl = process.env.AGENT_DECISION_FRAMEWORK_URL || 'http://localhost:3013';
    const res = await fetch(`${baseUrl}/v1/decisions/history?agentId=${params.id}&limit=${limit}`, {
      headers: { 'x-merchant-id': merchantId },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return NextResponse.json({ data: [] }, { status: 200 });
    }

    const body = (await res.json()) as { data?: unknown[] };
    return NextResponse.json({ data: body.data ?? [] });
  } catch (err) {
    console.error('[decisions] fetch error:', err);
    return NextResponse.json({ data: [] }, { status: 200 });
  }
}

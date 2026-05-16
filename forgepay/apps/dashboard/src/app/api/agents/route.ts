/**
 * GET /api/agents — List all agents for this merchant
 * Auth: Bearer token from NextAuth session
 */

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const merchantId = (session.user as any).merchantId || 'merchant-default';

  try {
    const baseUrl = process.env.AGENT_IDENTITY_URL || 'http://localhost:3010';
    const res = await fetch(`${baseUrl}/v1/agents?merchant=${merchantId}`, {
      headers: { 'x-merchant-id': merchantId },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return NextResponse.json({ data: [] }, { status: 200 });
    }

    const body = (await res.json()) as { data?: unknown[] };
    return NextResponse.json({ data: body.data ?? [] });
  } catch (err) {
    console.error('[agents] fetch error:', err);
    return NextResponse.json({ data: [], error: 'Service unavailable' }, { status: 503 });
  }
}

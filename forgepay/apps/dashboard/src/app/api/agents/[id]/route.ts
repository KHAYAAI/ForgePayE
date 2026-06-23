/**
 * GET /api/agents/[id] — Get a single agent by ID
 * Proxies to AGENT_IDENTITY_URL/v1/agents/{id}
 */

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const merchantId = (session.user as Record<string, unknown>).merchantId as string | undefined
    ?? 'merchant-default';

  const { id } = await params;

  try {
    const baseUrl = process.env['AGENT_IDENTITY_URL'] ?? 'http://localhost:3010';
    const res = await fetch(`${baseUrl}/v1/agents/${id}`, {
      headers: { 'x-merchant-id': merchantId },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const status = res.status === 404 ? 404 : 502;
      return NextResponse.json({ error: 'Agent not found' }, { status });
    }

    const body = await res.json();
    return NextResponse.json(body.data ?? body);
  } catch (err) {
    console.error('[agents/[id]] fetch error:', err);
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
}

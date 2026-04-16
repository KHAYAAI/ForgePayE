import { type NextRequest, NextResponse } from 'next/server';
import { getSessionApiKey, unauthorizedResponse, UnauthorizedError } from '@/lib/session';
import { listPayments } from '@/lib/hyperswitch-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const apiKey = await getSessionApiKey();

    // Forward any filter params the browser sends (status, limit, cursor, etc.)
    const params: Record<string, string> = {};
    req.nextUrl.searchParams.forEach((v, k) => { params[k] = v; });

    const data = await listPayments(apiKey, params);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

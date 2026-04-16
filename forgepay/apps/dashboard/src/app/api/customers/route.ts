import { type NextRequest, NextResponse } from 'next/server';
import { getSessionApiKey, unauthorizedResponse, UnauthorizedError } from '@/lib/session';
import { listCustomers } from '@/lib/hyperswitch-server';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  try {
    const apiKey = await getSessionApiKey();
    const data   = await listCustomers(apiKey);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

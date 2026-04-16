import { type NextRequest, NextResponse } from 'next/server';
import { getSessionApiKey, unauthorizedResponse, UnauthorizedError } from '@/lib/session';
import { retrievePayment } from '@/lib/hyperswitch-server';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const apiKey    = await getSessionApiKey();
    const { id }    = await params;
    const data      = await retrievePayment(apiKey, id);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    const message = err instanceof Error ? err.message : 'Internal error';
    const status  = message.includes('not found') ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

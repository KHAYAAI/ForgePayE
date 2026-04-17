import { type NextRequest, NextResponse } from 'next/server';
import { getSessionApiKey, unauthorizedResponse, UnauthorizedError } from '@/lib/session';

export const runtime = 'nodejs';

const UNIFIED_ROUTER = process.env['UNIFIED_ROUTER_URL'] ?? 'http://unified-router:8000';
const INTERNAL_SECRET = process.env['INTERNAL_WEBHOOK_SECRET'] ?? 'dev-internal-secret-change-me';

async function routerRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${UNIFIED_ROUTER}${path}`, {
    method,
    headers: {
      'Content-Type':           'application/json',
      'x-internal-auth':        INTERNAL_SECRET,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `Router error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function GET() {
  try {
    await getSessionApiKey();
    const data = await routerRequest('GET', '/events/webhook-endpoints');
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    return NextResponse.json({ data: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    await getSessionApiKey();
    const body = await req.json() as { url: string; description?: string };
    const data = await routerRequest('POST', '/events/webhook-endpoints', body);
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

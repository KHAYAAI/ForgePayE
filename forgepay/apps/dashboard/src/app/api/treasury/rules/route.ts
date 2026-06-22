import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const TREASURY_URL = process.env['ENTERPRISE_TREASURY_URL'] ?? 'http://localhost:3012';

export async function GET() {
  try {
    const resp = await fetch(`${TREASURY_URL}/v1/rules`, {
      headers: { 'x-source': 'dashboard' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return NextResponse.json({ error: 'Upstream error' }, { status: resp.status });
    return NextResponse.json(await resp.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const resp = await fetch(`${TREASURY_URL}/v1/rules`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-source': 'dashboard' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(8_000),
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

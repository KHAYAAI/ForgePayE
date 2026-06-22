import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const CREDIT_URL = process.env['AGENT_CREDIT_LINES_URL'] ?? 'http://localhost:3016';

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.search;
    const resp = await fetch(`${CREDIT_URL}/v1/draws${qs}`, {
      headers: { 'x-source': 'dashboard' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return NextResponse.json({ error: 'Upstream error' }, { status: resp.status });
    return NextResponse.json(await resp.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

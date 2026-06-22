import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const TREASURY_URL = process.env['ENTERPRISE_TREASURY_URL'] ?? 'http://localhost:3012';

export async function GET() {
  try {
    const resp = await fetch(`${TREASURY_URL}/v1/cash-position`, {
      headers: { 'x-source': 'dashboard' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) {
      return NextResponse.json({ error: 'Upstream error' }, { status: resp.status });
    }
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream unavailable';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

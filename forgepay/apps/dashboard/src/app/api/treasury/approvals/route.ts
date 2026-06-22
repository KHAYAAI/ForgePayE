import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const TREASURY_URL = process.env['ENTERPRISE_TREASURY_URL'] ?? 'http://localhost:3012';

export async function GET() {
  try {
    const resp = await fetch(`${TREASURY_URL}/v1/rules/approvals`, {
      headers: { 'x-source': 'dashboard' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return NextResponse.json({ error: 'Upstream error' }, { status: resp.status });
    return NextResponse.json(await resp.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

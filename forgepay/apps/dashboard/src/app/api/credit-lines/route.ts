import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const CREDIT_URL = process.env['AGENT_CREDIT_LINES_URL'] ?? 'http://localhost:3016';

export async function GET() {
  try {
    const [summaryResp, linesResp] = await Promise.all([
      fetch(`${CREDIT_URL}/v1/agent/summary`, {
        headers: { 'x-source': 'dashboard' },
        signal: AbortSignal.timeout(8_000),
      }),
      fetch(`${CREDIT_URL}/v1/credit-lines`, {
        headers: { 'x-source': 'dashboard' },
        signal: AbortSignal.timeout(8_000),
      }),
    ]);

    const summary = summaryResp.ok ? await summaryResp.json() : null;
    const lines   = linesResp.ok   ? await linesResp.json()   : { data: [] };

    return NextResponse.json({ summary, lines: lines.data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

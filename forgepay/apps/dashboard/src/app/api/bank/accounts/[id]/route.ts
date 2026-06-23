import { type NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
const BANK_URL = process.env['BANK_CONNECTIVITY_URL'] ?? 'http://localhost:3006';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const resp = await fetch(`${BANK_URL}/api/v1/accounts/${params.id}`, {
      method: 'DELETE',
      headers: { 'x-source': 'dashboard' },
      signal: AbortSignal.timeout(8_000),
    });
    return NextResponse.json({}, { status: resp.ok ? 204 : resp.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const resp = await fetch(`${BANK_URL}/api/v1/accounts/${params.id}/refresh`, {
      method: 'POST',
      headers: { 'x-source': 'dashboard' },
      signal: AbortSignal.timeout(10_000),
    });
    const data = resp.ok ? await resp.json() : {};
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

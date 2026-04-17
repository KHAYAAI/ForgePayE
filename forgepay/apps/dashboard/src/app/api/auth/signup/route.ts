import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// In a full multi-tenant deployment this would INSERT into a merchants table
// and issue a real Hyperswitch sub-merchant API key. For the initial deployment,
// new accounts are registered against the mor-layer merchant API.
const MOR_BASE = process.env['MOR_LAYER_URL'] ?? 'http://mor-layer:8010';

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json() as {
      name:     string;
      email:    string;
      password: string;
    };

    if (!email || !password || !name) {
      return NextResponse.json({ error: 'name, email and password are required' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Forward account creation to the mor-layer merchant registration endpoint.
    const res = await fetch(`${MOR_BASE}/v1/merchants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { detail?: string };
      const msg  = body.detail ?? `Merchant registration failed (${res.status})`;
      const code = res.status === 409 ? 409 : 502;
      return NextResponse.json({ error: msg }, { status: code });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

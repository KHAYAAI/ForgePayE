import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MOCK_KEYS = [
  {
    id: 'key_01',
    name: 'Production',
    key: 'fpk_live_3xT4...k9mN',
    mode: 'live',
    created: 'Apr 1, 2026',
    last_used: '2 min ago',
  },
  {
    id: 'key_02',
    name: 'Test',
    key: 'fpk_test_7yU8...q2pX',
    mode: 'test',
    created: 'Mar 15, 2026',
    last_used: '1 hr ago',
  },
];

export async function GET(_req: NextRequest) {
  return NextResponse.json({ data: MOCK_KEYS, count: MOCK_KEYS.length });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name, mode = 'test' } = body as { name?: string; mode?: string };

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const newKey = {
    id: `key_${Date.now()}`,
    name,
    key: `fpk_${mode}_${Math.random().toString(36).slice(2, 10)}...${Math.random().toString(36).slice(2, 6)}`,
    mode,
    created: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    last_used: 'Never',
  };

  return NextResponse.json({ data: newKey }, { status: 201 });
}

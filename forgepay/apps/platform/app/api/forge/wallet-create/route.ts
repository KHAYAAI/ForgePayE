/**
 * Console data proxy — POST /api/forge/wallet-create
 *
 * Creates a real wallet for the current tenant via open-privy.
 */

import { NextResponse } from 'next/server';
import { createWallet } from '@/lib/openprivy';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { chain?: string } | null;
  if (!body?.chain) {
    return NextResponse.json({ error: 'ValidationError', message: 'chain is required' }, { status: 400 });
  }

  try {
    const wallet = await createWallet(user.tenantId, body.chain);
    return NextResponse.json({ data: wallet }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'CreateFailed', message }, { status: 502 });
  }
}

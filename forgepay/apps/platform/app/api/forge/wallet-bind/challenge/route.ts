/**
 * POST /api/forge/wallet-bind/challenge  { address, agentId }
 * Start linking a wallet the user controls to an agent. Returns a message for the wallet to sign. Nothing is stored about
 * a key, and signing moves no funds.
 */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { createWalletChallenge } from '@/lib/wallet-binding';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:billing' });
  if ('response' in g) return g.response;
  const body = (await req.json().catch(() => null)) as { address?: unknown; agentId?: unknown } | null;
  const result = await createWalletChallenge({
    tenantId: g.user.tenantId,
    address: body?.address as string,
    agentId: body?.agentId as string,
  });
  if (result.ok === false) return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
  return NextResponse.json({ data: { nonce: result.nonce, message: result.message, expiresAt: result.expiresAt, address: result.address } }, { status: 201 });
}

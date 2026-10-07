/**
 * POST /api/forge/wallet-bind/verify  { nonce, signature, operatorEntityId, operatorEntityType, ... }
 * Check the signature, then register the agent with the self-certifying identity of that wallet (did:forge:0x...). The bureau
 * then holds an agent whose address was proven, not just typed in.
 */

import { guardRoute } from '@/lib/route-guard';
import { NextResponse } from 'next/server';
import { didForWallet, recordWalletBinding, verifyWalletChallenge } from '@/lib/wallet-binding';
import { registerBureauAgent, type RegisterAgentInput } from '@/lib/forge-services';
import { clientIp, logAuditEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const ENTITY_TYPES = ['individual', 'llc', 'corp', 'dao'] as const;

export async function POST(req: Request) {
  const g = await guardRoute({ product: 'credit-bureau', permission: 'manage:billing' });
  if ('response' in g) return g.response;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const operatorEntityId = typeof body?.operatorEntityId === 'string' ? body.operatorEntityId.trim() : '';
  const operatorEntityType = body?.operatorEntityType;
  if (!operatorEntityId || typeof operatorEntityType !== 'string' || !(ENTITY_TYPES as readonly string[]).includes(operatorEntityType)) {
    return NextResponse.json(
      { error: 'ValidationError', message: `operatorEntityId and operatorEntityType (${ENTITY_TYPES.join(', ')}) are required` },
      { status: 400 },
    );
  }

  const proof = await verifyWalletChallenge(g.user.tenantId, body?.nonce as string, body?.signature as string);
  if (proof.ok === false) return NextResponse.json({ error: proof.error, message: proof.message }, { status: proof.status });

  const input: RegisterAgentInput = {
    agentId: proof.agentId,
    did: didForWallet(proof.address),
    evmAddress: proof.address,
    operatorEntityId,
    operatorEntityType: operatorEntityType as RegisterAgentInput['operatorEntityType'],
    ...(typeof body?.operatorLegalName === 'string' && body.operatorLegalName ? { operatorLegalName: body.operatorLegalName } : {}),
    ...(typeof body?.operatorCountry === 'string' && body.operatorCountry ? { operatorCountry: body.operatorCountry.toUpperCase() } : {}),
    ...(typeof body?.operatorRegistrationNumber === 'string' && body.operatorRegistrationNumber ? { operatorRegistrationNumber: body.operatorRegistrationNumber } : {}),
  };
  const registered = await registerBureauAgent(g.user.tenantId, input);
  if (registered.ok === false) {
    return NextResponse.json({ error: 'RegistrationFailed', detail: registered.error, message: 'The wallet was verified, but the bureau could not register the agent. Start again.' }, { status: registered.status || 502 });
  }

  await recordWalletBinding(g.user.tenantId, proof.address, proof.agentId, g.user.email);
  await logAuditEvent({
    tenantId: g.user.tenantId, actorUserId: g.user.userId, actorEmail: g.user.email,
    action: 'wallet.bound', resource: proof.agentId, detail: { address: proof.address, did: input.did },
    ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });
  return NextResponse.json({ data: { agentId: proof.agentId, did: input.did, address: proof.address, agent: registered.data } }, { status: 201 });
}

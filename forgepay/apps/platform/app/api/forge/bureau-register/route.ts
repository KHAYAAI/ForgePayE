/**
 * Console data proxy — POST /api/forge/bureau-register
 *
 * Registers a new agent credit profile — the console's only write path
 * onto the bureau's register (GET /v1/agents lists what already exists;
 * this is how a new one gets there in the first place).
 */

import { NextResponse } from 'next/server';
import { registerBureauAgent, type RegisterAgentInput } from '@/lib/forge-services';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<RegisterAgentInput> | null;
  if (!body?.agentId || !body.did || !body.operatorEntityId || !body.operatorEntityType) {
    return NextResponse.json(
      { error: 'ValidationError', message: 'agentId, did, operatorEntityId and operatorEntityType are required' },
      { status: 400 },
    );
  }
  const result = await registerBureauAgent(body as RegisterAgentInput);
  if (result.ok === false) {
    return NextResponse.json({ error: 'RegistrationFailed', detail: result.error }, { status: result.status || 502 });
  }
  return NextResponse.json({ data: result.data }, { status: 201 });
}

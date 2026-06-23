/**
 * GET  /api/subscriptions/[id] — Retrieve a single subscription
 * PATCH /api/subscriptions/[id] — Perform an action on a subscription
 *
 * PATCH body: { action: 'suspend' | 'resume' | 'cancel' }
 *
 * Auth: requires a valid NextAuth session.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { unauthorizedResponse } from '@/lib/session';
import {
  getSubscription,
  suspendSubscription,
  resumeSubscription,
  cancelSubscription,
} from '@/lib/killbill-server';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _req: NextRequest,
  { params }: RouteContext,
) {
  const session = await getServerSession();
  if (!session?.user?.email) return unauthorizedResponse();

  try {
    const { id } = await params;
    const data   = await getSubscription(id);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const status  = message.toLowerCase().includes('not found') ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: RouteContext,
) {
  const session = await getServerSession();
  if (!session?.user?.email) return unauthorizedResponse();

  const { id }     = await params;
  const body        = await req.json().catch(() => ({})) as { action?: string };
  const { action }  = body;

  try {
    switch (action) {
      case 'suspend':
        await suspendSubscription(id);
        return NextResponse.json({ ok: true, action: 'suspend', subscriptionId: id });

      case 'resume':
        await resumeSubscription(id);
        return NextResponse.json({ ok: true, action: 'resume', subscriptionId: id });

      case 'cancel':
        await cancelSubscription(id);
        return NextResponse.json({ ok: true, action: 'cancel', subscriptionId: id });

      default:
        return NextResponse.json(
          { error: `Unknown action "${action}". Expected: suspend | resume | cancel` },
          { status: 400 },
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

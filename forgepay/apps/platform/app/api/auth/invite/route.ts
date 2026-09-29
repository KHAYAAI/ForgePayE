import { NextRequest, NextResponse } from 'next/server';
import { lookupInvitation } from '@/lib/invitations';

export const dynamic = 'force-dynamic';

/** Public: what the accept page shows before the invitee chooses a password. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const invite = token.length === 64 ? await lookupInvitation(token) : null;
  if (!invite) return NextResponse.json({ error: 'This invitation is invalid, expired, or already used.' }, { status: 410 });
  return NextResponse.json({ data: { email: invite.email, role: invite.role, workspace: invite.tenant_name } });
}

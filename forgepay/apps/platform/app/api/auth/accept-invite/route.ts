import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, setAuthCookie } from '@/lib/auth';
import { logAuditEvent, clientIp } from '@/lib/audit';
import { InviteError, acceptInvitation } from '@/lib/invitations';

const schema = z.object({ token: z.string().length(64), name: z.string().min(2), password: z.string().min(8) });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'A name and a password of at least 8 characters are required.' }, { status: 400 });
  try {
    const user = await acceptInvitation(parsed.data.token, parsed.data.name, parsed.data.password);
    const { token } = await createSession(
      { userId: user.id, email: user.email, tenantId: user.tenant_id, role: user.role },
      { ipAddress: clientIp(req), userAgent: req.headers.get('user-agent') },
    );
    await setAuthCookie(token);
    await logAuditEvent({
      tenantId: user.tenant_id, actorUserId: user.id, actorEmail: user.email, action: 'team.invite_accepted',
      detail: { role: user.role }, ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
    });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    if (err instanceof InviteError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

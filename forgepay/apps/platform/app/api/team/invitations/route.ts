import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { logAuditEvent, clientIp } from '@/lib/audit';
import { INVITABLE_ROLES, InviteError, createInvitation, inviteLink, listPending } from '@/lib/invitations';
import { sendEmail } from '@/lib/email';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!can(user.role, 'manage:team')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ data: await listPending(user.tenantId) });
}

const body = z.object({ email: z.string().email(), role: z.enum(INVITABLE_ROLES) });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!can(user.role, 'manage:team')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'A valid email and a role (admin, approver, analyst) are required.' }, { status: 400 });

  try {
    const invite = await createInvitation(user.tenantId, parsed.data.email, parsed.data.role, user.email);
    const link = inviteLink(invite.token, req.nextUrl.origin);
    const tenant = await queryOne<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [user.tenantId]);
    // Email is best-effort: SMTP may not be configured, so the link is also
    // returned for the inviter to send themselves. It is shown once only.
    const emailed = await sendEmail({
      to: parsed.data.email,
      subject: `${user.email} invited you to ${tenant?.name ?? 'a FORGE workspace'}`,
      html: `<p>${user.email} invited you to join <strong>${tenant?.name ?? 'their workspace'}</strong> on FORGE as ${parsed.data.role}.</p><p><a href="${link}">Accept the invitation</a></p><p>This link expires in 7 days and works once.</p>`,
      text: `Accept your FORGE invitation: ${link}`,
    });
    await logAuditEvent({
      tenantId: user.tenantId, actorUserId: user.userId, actorEmail: user.email, action: 'team.invited',
      resource: parsed.data.email, detail: { role: parsed.data.role, emailed }, ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
    });
    return NextResponse.json({ data: { id: invite.id, email: parsed.data.email, role: parsed.data.role, expiresAt: invite.expiresAt, link, emailed } }, { status: 201 });
  } catch (err) {
    if (err instanceof InviteError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

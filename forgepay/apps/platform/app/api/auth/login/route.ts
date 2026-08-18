import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getUserByEmail,
  verifyPassword,
  createSession,
  setAuthCookie,
  generateMfaPendingToken,
  setMfaPendingCookie,
} from '@/lib/auth';
import { logAuditEvent, clientIp } from '@/lib/audit';
import { getTenantById } from '@/lib/sso';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function POST(req: NextRequest) {
  const ipAddress = clientIp(req);
  const userAgent = req.headers.get('user-agent');

  try {
    const body = await req.json();
    const { email, password } = loginSchema.parse(body);

    const user = await getUserByEmail(email);
    if (!user) {
      await logAuditEvent({
        action: 'auth.login_failed', actorEmail: email,
        detail: { reason: 'no_such_user' }, ipAddress, userAgent,
      });
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const tenant = await getTenantById(user.tenant_id);
    if (tenant?.sso_required) {
      await logAuditEvent({
        tenantId: user.tenant_id, actorUserId: user.id, actorEmail: user.email,
        action: 'auth.login_failed', detail: { reason: 'sso_required' }, ipAddress, userAgent,
      });
      return NextResponse.json(
        { error: 'This organization requires signing in through SSO.', ssoRequired: true },
        { status: 403 }
      );
    }

    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      await logAuditEvent({
        tenantId: user.tenant_id, actorUserId: user.id, actorEmail: user.email,
        action: 'auth.login_failed', detail: { reason: 'wrong_password' },
        ipAddress, userAgent,
      });
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Password correct, but not a session yet if MFA is enabled — the
    // client must complete POST /api/auth/mfa/verify with a TOTP or backup
    // code before a real session is minted.
    if (user.totp_enabled) {
      const pendingToken = generateMfaPendingToken(user.id);
      await setMfaPendingCookie(pendingToken);
      return NextResponse.json({ success: true, mfaRequired: true });
    }

    const { token } = await createSession(
      { userId: user.id, email: user.email, tenantId: user.tenant_id, role: user.role ?? 'analyst' },
      { ipAddress, userAgent },
    );
    await setAuthCookie(token);

    await logAuditEvent({
      tenantId: user.tenant_id, actorUserId: user.id, actorEmail: user.email,
      action: 'auth.login_success', ipAddress, userAgent,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tenantId: user.tenant_id,
        apiKey: user.api_key,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}

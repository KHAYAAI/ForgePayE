import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeSsoCode, getTenantByWorkosOrganizationId } from '@/lib/sso';
import { findOrCreateSsoUser, createSession, setAuthCookie } from '@/lib/auth';
import { logAuditEvent, clientIp } from '@/lib/audit';

/** WorkOS redirects here after the user authenticates with their IdP. Exchanges the code for a profile and mints a real session. */
export async function GET(req: NextRequest) {
  const loginUrl = new URL('/auth/sso', req.url);
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');

  const cookieStore = await cookies();
  const expectedState = cookieStore.get('sso-state')?.value;
  cookieStore.delete('sso-state');

  if (!code) {
    loginUrl.searchParams.set('error', 'Sign-in was cancelled or failed.');
    return NextResponse.redirect(loginUrl);
  }
  if (!expectedState || !state || state !== expectedState) {
    loginUrl.searchParams.set('error', 'Sign-in session expired. Try again.');
    return NextResponse.redirect(loginUrl);
  }

  let profile;
  try {
    profile = await exchangeSsoCode(code);
  } catch (err) {
    console.error('[sso] failed to exchange code for profile:', err);
    loginUrl.searchParams.set('error', 'Sign-in failed. Try again.');
    return NextResponse.redirect(loginUrl);
  }

  if (!profile.organizationId) {
    loginUrl.searchParams.set('error', 'This identity provider is not linked to a ForgePay organization.');
    return NextResponse.redirect(loginUrl);
  }

  const tenant = await getTenantByWorkosOrganizationId(profile.organizationId);
  if (!tenant) {
    loginUrl.searchParams.set('error', 'This organization is not configured in ForgePay.');
    return NextResponse.redirect(loginUrl);
  }

  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.email;
  const user = await findOrCreateSsoUser(profile.email, name, tenant.id);

  const { token } = await createSession(
    { userId: user.id, email: user.email, tenantId: user.tenant_id, role: user.role ?? 'analyst' },
    { ipAddress: clientIp(req), userAgent: req.headers.get('user-agent') },
  );
  await setAuthCookie(token);

  await logAuditEvent({
    tenantId: tenant.id, actorUserId: user.id, actorEmail: user.email,
    action: 'auth.sso_login_success', detail: { connectionId: profile.connectionId },
    ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'),
  });

  return NextResponse.redirect(new URL('/dashboard', req.url));
}

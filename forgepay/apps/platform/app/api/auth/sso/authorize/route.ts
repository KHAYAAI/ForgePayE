import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { isSsoConfigured, findSsoTenantForEmail, buildSsoAuthorizationUrl } from '@/lib/sso';

/** Starting point for "Sign in with SSO": look up the caller's org by email domain and redirect to their IdP via WorkOS. */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase();
  const loginUrl = new URL('/auth/sso', req.url);

  if (!email || !email.includes('@')) {
    loginUrl.searchParams.set('error', 'Enter your work email to continue.');
    return NextResponse.redirect(loginUrl);
  }

  if (!isSsoConfigured()) {
    loginUrl.searchParams.set('error', 'SSO is not configured for this deployment yet.');
    return NextResponse.redirect(loginUrl);
  }

  const tenant = await findSsoTenantForEmail(email);
  if (!tenant?.workos_organization_id) {
    loginUrl.searchParams.set('error', "We couldn't find an SSO connection for that email domain.");
    return NextResponse.redirect(loginUrl);
  }

  const state = randomBytes(24).toString('hex');
  const cookieStore = await cookies();
  cookieStore.set('sso-state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60,
  });

  return NextResponse.redirect(buildSsoAuthorizationUrl(tenant.workos_organization_id, state));
}

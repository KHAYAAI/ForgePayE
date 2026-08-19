import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import {
  buildSsoAuthorizationUrl,
  findSsoOrganizationForEmail,
  isSsoConfigured,
} from '@/lib/sso';

/**
 * Start "Sign in with SSO": resolve the caller's email domain to a WorkOS
 * organization and hand back the URL of that organization's IdP.
 *
 * Answers `{ ssoAvailable: false }` rather than an error when the domain has
 * no SSO connection, so the login page can fall back to password without
 * treating it as a failure. That answer is domain-level — "this company is
 * set up for SSO here" — and deliberately says nothing about whether an
 * account exists for the address, which would be an enumeration oracle.
 */
export async function POST(req: NextRequest) {
  if (!isSsoConfigured()) {
    return NextResponse.json({ ssoAvailable: false }, { status: 200 });
  }

  let email: string | undefined;
  try {
    ({ email } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }

  try {
    const organizationId = await findSsoOrganizationForEmail(email);
    if (!organizationId) {
      return NextResponse.json({ ssoAvailable: false });
    }

    // Bound to the browser in an httpOnly cookie and echoed back by WorkOS in
    // the callback's query; the callback refuses any response whose state
    // doesn't match, which is what stops an attacker-initiated handshake from
    // completing in someone else's browser.
    const state = randomBytes(32).toString('hex');
    const ssoUrl = buildSsoAuthorizationUrl(organizationId, state, email);

    const res = NextResponse.json({ ssoAvailable: true, ssoUrl });
    res.cookies.set('sso-state', state, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path:     '/',
      maxAge:   10 * 60,
    });
    return res;
  } catch (err) {
    console.error('[sso-authorize] failed:', err);
    return NextResponse.json({ error: 'Failed to start SSO' }, { status: 500 });
  }
}

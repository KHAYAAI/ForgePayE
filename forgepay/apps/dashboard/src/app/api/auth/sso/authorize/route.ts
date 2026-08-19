import { NextRequest, NextResponse } from 'next/server';
import { buildSsoAuthorizationUrl, isSsoConfigured } from '@/lib/sso';
import { randomBytes } from 'node:crypto';

export async function POST(req: NextRequest) {
  try {
    if (!isSsoConfigured()) {
      return NextResponse.json(
        { error: 'SSO is not configured' },
        { status: 400 },
      );
    }

    const { email } = await req.json();
    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 },
      );
    }

    // Generate state for CSRF protection
    const state = randomBytes(32).toString('hex');

    // Build SSO URL (redirects to merchant's company IdP)
    const ssoUrl = buildSsoAuthorizationUrl(email, state);

    // Store state in a short-lived cookie for validation
    const response = NextResponse.json({ ssoUrl });
    response.cookies.set('sso-state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60, // 10 minutes
    });

    return response;
  } catch (err) {
    console.error('[sso-authorize] error:', err);
    return NextResponse.json(
      { error: 'Failed to initiate SSO' },
      { status: 500 },
    );
  }
}

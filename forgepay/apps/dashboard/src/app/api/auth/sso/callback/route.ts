import { NextRequest, NextResponse } from 'next/server';
import { exchangeSsoCode } from '@/lib/sso';
import { queryOne, execute } from '@/lib/db';
import { createSession } from '@/lib/sessions';
import { logAuditEvent } from '@/lib/audit';
import { randomUUID } from 'node:crypto';

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');

    if (!code) {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
    }

    // Exchange code for SSO profile
    const ssoProfile = await exchangeSsoCode(code);

    // Find or create merchant by email
    let merchant = await queryOne<any>(
      `SELECT * FROM merchants WHERE email = $1`,
      [ssoProfile.email],
    );

    if (!merchant) {
      // Auto-create merchant from SSO profile
      const merchantId = `merchant_${randomUUID()}`;
      const apiKey = `pk_${randomUUID()}`;
      const fullName = `${ssoProfile.firstName} ${ssoProfile.lastName}`.trim() || ssoProfile.email;

      await execute(
        `INSERT INTO merchants (id, email, name, api_key, workos_organization_id, workos_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [merchantId, ssoProfile.email, fullName, apiKey, ssoProfile.organizationId, ssoProfile.id],
      );

      merchant = {
        id: merchantId,
        email: ssoProfile.email,
        name: fullName,
        api_key: apiKey,
        workos_organization_id: ssoProfile.organizationId,
        workos_id: ssoProfile.id,
      };

      await logAuditEvent({
        merchantId: merchant.id,
        actorMerchantId: merchant.id,
        actorEmail: merchant.email,
        action: 'auth.signup',
        detail: { via: 'sso', workos_organization_id: ssoProfile.organizationId },
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        userAgent: req.headers.get('user-agent'),
      });
    } else {
      // Update existing merchant's WorkOS info if needed
      if (!merchant.workos_organization_id) {
        await execute(
          `UPDATE merchants SET workos_organization_id = $1, workos_id = $2, updated_at = NOW()
           WHERE id = $3`,
          [ssoProfile.organizationId, ssoProfile.id, merchant.id],
        );
        merchant.workos_organization_id = ssoProfile.organizationId;
        merchant.workos_id = ssoProfile.id;
      }
    }

    // Create session
    const { sessionId } = await createSession(merchant.id, {
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      userAgent: req.headers.get('user-agent'),
    });

    await logAuditEvent({
      merchantId: merchant.id,
      actorMerchantId: merchant.id,
      actorEmail: merchant.email,
      action: 'auth.login_success',
      detail: { via: 'sso' },
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      userAgent: req.headers.get('user-agent'),
    });

    // Create JWT via NextAuth callback manually — redirect to set cookie
    // In production, you'd use NextAuth's signIn() redirect or create a server action
    const redirectUrl = new URL('/dashboard', req.nextUrl.origin);
    const response = NextResponse.redirect(redirectUrl);

    // Set session cookie (note: in production you'd coordinate with NextAuth's session handling)
    response.cookies.set('merchant-sso-session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    console.error('[sso-callback] error:', err);
    const errorUrl = new URL('/login?error=sso_failed', req.nextUrl.origin);
    return NextResponse.redirect(errorUrl);
  }
}

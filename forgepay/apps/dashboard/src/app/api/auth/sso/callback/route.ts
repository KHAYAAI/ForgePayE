import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { exchangeSsoCode } from '@/lib/sso';
import { execute } from '@/lib/db';
import { getMerchantByEmail } from '@/lib/merchants';
import { issueSsoTicket } from '@/lib/sso-ticket';
import { logAuditEvent, clientIp } from '@/lib/audit';

/**
 * Where WorkOS returns the merchant after their IdP has authenticated them.
 *
 * This route does NOT mint the session itself — it issues a single-use ticket
 * and redirects to /login, which spends it through NextAuth's credentials
 * flow (see lib/sso-ticket.ts for why the hand-off works this way).
 */
export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');

  if (!code) return failTo(req, 'sso_missing_code');

  // The state we minted in /authorize came back in a cookie; WorkOS echoes
  // its copy in the query. Both must match, or this is a response to a
  // handshake we never started — the CSRF case this parameter exists for.
  const expectedState = req.cookies.get('sso-state')?.value;
  if (!expectedState || !state || !safeEqual(state, expectedState)) {
    return failTo(req, 'sso_state_mismatch');
  }

  try {
    const profile = await exchangeSsoCode(code);

    let merchant = await getMerchantByEmail(profile.email);

    if (!merchant) {
      // First SSO login for this address: provision a local merchant.
      //
      // NOTE: this row carries no Hyperswitch api_key — mor-layer issues
      // those, and nothing here can conjure a valid one. Such a merchant can
      // sign in and use the dashboard's own surfaces, but payment calls will
      // fail until an operator links the account to its mor-layer record. A
      // fabricated key would look like it worked and fail confusingly later.
      const merchantId = `merchant_${randomUUID()}`;
      const fullName =
        `${profile.firstName} ${profile.lastName}`.trim() || profile.email;

      await execute(
        `INSERT INTO merchants (id, email, name, api_key, workos_organization_id, workos_id)
         VALUES ($1, $2, $3, NULL, $4, $5)`,
        [merchantId, profile.email, fullName, profile.organizationId, profile.id],
      );

      await logAuditEvent({
        merchantId,
        actorMerchantId: merchantId,
        actorEmail:      profile.email,
        action:          'auth.signup',
        detail:          { via: 'sso', workosOrganizationId: profile.organizationId },
        ipAddress:       clientIp(req),
        userAgent:       req.headers.get('user-agent'),
      });

      merchant = await getMerchantByEmail(profile.email);
    } else if (!merchant.workos_organization_id) {
      // Existing password-based merchant signing in via SSO for the first
      // time — record the linkage.
      await execute(
        `UPDATE merchants
            SET workos_organization_id = $1, workos_id = $2, updated_at = NOW()
          WHERE id = $3`,
        [profile.organizationId, profile.id, merchant.id],
      );
    }

    if (!merchant) return failTo(req, 'sso_provisioning_failed');

    const ticket = await issueSsoTicket(merchant.id);

    const redirect = new URL('/login', req.nextUrl.origin);
    redirect.searchParams.set('sso_ticket', ticket);

    const res = NextResponse.redirect(redirect);
    res.cookies.delete('sso-state'); // one handshake, one state
    return res;
  } catch (err) {
    console.error('[sso-callback] exchange failed:', err);
    return failTo(req, 'sso_failed');
  }
}

/** Send the browser back to the login page with a reason, never a stack trace. */
function failTo(req: NextRequest, reason: string): NextResponse {
  const url = new URL('/login', req.nextUrl.origin);
  url.searchParams.set('error', reason);
  const res = NextResponse.redirect(url);
  res.cookies.delete('sso-state');
  return res;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

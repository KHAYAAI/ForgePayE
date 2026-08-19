import { getWorkOS, isWorkOsConfigured, ssoRedirectUri } from './workos';
import { queryOne } from './db';

/**
 * Enterprise SSO for merchants, brokered by WorkOS.
 *
 * WorkOS sits in front of the actual IdPs (Okta, Azure AD, Google Workspace,
 * SAML), so this app integrates once instead of once per customer. A merchant
 * whose email domain belongs to an org with an SSO connection configured is
 * routed to that org's IdP; everyone else keeps using password + MFA.
 */

export { isWorkOsConfigured as isSsoConfigured };

export interface SsoProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string | null;
}

/**
 * The WorkOS organization an email address belongs to, or null if its domain
 * has no SSO connection configured (the ordinary case for most merchants).
 */
export async function findSsoOrganizationForEmail(email: string): Promise<string | null> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;

  const row = await queryOne<{ workos_organization_id: string }>(
    `SELECT workos_organization_id FROM sso_domains WHERE domain = $1`,
    [domain],
  );
  return row?.workos_organization_id ?? null;
}

/**
 * Authorization URL that sends the merchant to their organization's IdP.
 *
 * Takes an already-resolved organization id: the handshake must name a
 * connection, organization, or provider — there is no route-by-email-domain
 * parameter — so callers resolve the domain first via
 * findSsoOrganizationForEmail(). `loginHint` is passed so the IdP can
 * pre-fill the address rather than asking for it a second time.
 */
export function buildSsoAuthorizationUrl(
  organizationId: string,
  state: string,
  email?: string,
): string {
  return getWorkOS().sso.getAuthorizationUrl({
    organization: organizationId,
    clientId:     process.env['WORKOS_CLIENT_ID']!,
    redirectUri:  ssoRedirectUri(),
    state,
    ...(email ? { loginHint: email } : {}),
  });
}

/**
 * Exchange the callback's authorization code for the authenticated profile.
 *
 * `getProfileAndToken` is the code-exchange call; `sso.getProfile` is a
 * different thing entirely (it reads a profile from an access token already
 * in hand) and passing a code to it silently fails.
 */
export async function exchangeSsoCode(code: string): Promise<SsoProfile> {
  const { profile } = await getWorkOS().sso.getProfileAndToken({
    code,
    clientId: process.env['WORKOS_CLIENT_ID']!,
  });

  return {
    id:             profile.id,
    email:          profile.email,
    firstName:      profile.firstName ?? '',
    lastName:       profile.lastName ?? '',
    organizationId: profile.organizationId ?? null,
  };
}

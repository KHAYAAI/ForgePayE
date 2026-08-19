import { WorkOS } from '@workos-inc/node';

/**
 * Merchant SSO via WorkOS domain-based routing.
 * Merchants in the same company (email domain) authenticate via their
 * company's IdP (Okta, Azure AD, Google Workspace, SAML, etc.).
 *
 * Requires WORKOS_API_KEY and WORKOS_CLIENT_ID — until then,
 * isSsoConfigured() is false and SSO routes gracefully refuse.
 */

let workosClient: WorkOS | null = null;

export function isSsoConfigured(): boolean {
  return !!(process.env.WORKOS_API_KEY && process.env.WORKOS_CLIENT_ID);
}

function getWorkOS(): WorkOS {
  if (!isSsoConfigured()) {
    throw new Error(
      'SSO is not configured. Set WORKOS_API_KEY and WORKOS_CLIENT_ID ' +
      '(from https://dashboard.workos.com) to enable it.',
    );
  }
  if (!workosClient) {
    workosClient = new WorkOS(process.env.WORKOS_API_KEY!, {
      clientId: process.env.WORKOS_CLIENT_ID!,
    });
  }
  return workosClient;
}

function redirectUri(): string {
  return (
    process.env.WORKOS_REDIRECT_URI ??
    `${process.env.NEXTAUTH_URL ?? 'http://localhost:3001'}/api/auth/sso/callback`
  );
}

export interface SsoProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string;
}

/**
 * Build SSO authorization URL for the merchant's email domain.
 * Redirects to their company's IdP (if configured in WorkOS).
 */
export function buildSsoAuthorizationUrl(email: string, state: string): string {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) {
    throw new Error('Invalid email domain for SSO');
  }

  return getWorkOS().sso.getAuthorizationUrl({
    domain,
    clientId: process.env.WORKOS_CLIENT_ID!,
    redirectUri: redirectUri(),
    state,
  });
}

/**
 * Exchange WorkOS authorization code for merchant profile.
 * Called by POST /api/auth/sso/callback after the merchant
 * authenticates with their company's IdP.
 */
export async function exchangeSsoCode(code: string): Promise<SsoProfile> {
  const profile = await getWorkOS().sso.getProfile(code);
  return {
    id: profile.id,
    email: profile.email,
    firstName: profile.first_name ?? '',
    lastName: profile.last_name ?? '',
    organizationId: profile.organization_id,
  };
}

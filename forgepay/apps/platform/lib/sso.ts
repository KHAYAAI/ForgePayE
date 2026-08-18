import { WorkOS } from '@workos-inc/node';
import { queryOne } from './db';

/**
 * Enterprise SSO, brokered through WorkOS's standalone SSO API (not the
 * full hosted AuthKit product — this console already has its own
 * users/sessions/JWT model, so brokering just the IdP handshake and mapping
 * the result onto createSession() is the right amount of WorkOS to take on).
 *
 * WorkOS sits in front of the actual enterprise IdPs (Okta, Azure AD, Google
 * Workspace, and SAML providers) so this service integrates once against
 * WorkOS's OIDC-shaped API instead of once per customer's IdP.
 *
 * Requires a real WorkOS account and API key before any of this does
 * anything — see the required env vars below. Until then,
 * isSsoConfigured() is false and every route in api/auth/sso/* returns a
 * clear "not configured" error rather than crashing.
 */

let workosClient: WorkOS | null = null;

export function isSsoConfigured(): boolean {
  return !!(process.env.WORKOS_API_KEY && process.env.WORKOS_CLIENT_ID);
}

function getWorkOS(): WorkOS {
  if (!isSsoConfigured()) {
    throw new Error(
      'SSO is not configured. Set WORKOS_API_KEY and WORKOS_CLIENT_ID ' +
      '(from your WorkOS dashboard — https://dashboard.workos.com) to enable it.',
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
  // WORKOS_REDIRECT_URI lets this be pinned explicitly (recommended — must
  // match a URI registered in the WorkOS dashboard exactly); falls back to
  // deriving it from the app's own base URL for local/dev use.
  return (
    process.env.WORKOS_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/auth/sso/callback`
  );
}

export interface SsoTenant {
  id: string;
  name: string;
  domain: string | null;
  workos_organization_id: string | null;
  sso_required: boolean;
}

/** Tenant configured for SSO on the given email's domain, or null if there isn't one — the "does this org even have SSO" check. */
export async function findSsoTenantForEmail(email: string): Promise<SsoTenant | null> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  return queryOne<SsoTenant>(
    `SELECT id, name, domain, workos_organization_id, sso_required
     FROM tenants WHERE domain = $1 AND workos_organization_id IS NOT NULL`,
    [domain],
  );
}

export function buildSsoAuthorizationUrl(organizationId: string, state: string): string {
  return getWorkOS().sso.getAuthorizationUrl({
    organization: organizationId,
    clientId: process.env.WORKOS_CLIENT_ID!,
    redirectUri: redirectUri(),
    state,
  });
}

export interface SsoProfile {
  id: string;
  organizationId: string | null;
  connectionId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export async function exchangeSsoCode(code: string): Promise<SsoProfile> {
  const { profile } = await getWorkOS().sso.getProfileAndToken({
    code,
    clientId: process.env.WORKOS_CLIENT_ID!,
  });
  return {
    id: profile.id,
    organizationId: profile.organizationId ?? null,
    connectionId: profile.connectionId,
    email: profile.email,
    firstName: profile.firstName ?? null,
    lastName: profile.lastName ?? null,
  };
}

export async function getTenantByWorkosOrganizationId(organizationId: string): Promise<SsoTenant | null> {
  return queryOne<SsoTenant>(
    `SELECT id, name, domain, workos_organization_id, sso_required FROM tenants WHERE workos_organization_id = $1`,
    [organizationId],
  );
}

export async function getTenantById(tenantId: string): Promise<SsoTenant | null> {
  return queryOne<SsoTenant>(
    `SELECT id, name, domain, workos_organization_id, sso_required FROM tenants WHERE id = $1`,
    [tenantId],
  );
}

import { WorkOS } from '@workos-inc/node';

/**
 * Shared WorkOS client for the merchant dashboard.
 *
 * WorkOS backs two things here:
 *   - SSO   (lib/sso.ts)        — enterprise IdP handshake, brokered per org
 *   - MFA   (lib/workos-mfa.ts) — TOTP factors, enrolled and verified by WorkOS
 *
 * Deliberately NOT the full AuthKit/User Management product: merchant
 * identity already lives in mor-layer (bcrypt-hashed, its own Hyperswitch
 * api_key per merchant), and sessions/audit live in this app's own Postgres.
 * WorkOS is used for the two pieces it does better than we would — brokering
 * enterprise IdPs, and custodying TOTP secrets so they never touch our DB.
 */

let client: WorkOS | null = null;

/** True once WORKOS_API_KEY and WORKOS_CLIENT_ID are both set. */
export function isWorkOsConfigured(): boolean {
  return !!(process.env['WORKOS_API_KEY'] && process.env['WORKOS_CLIENT_ID']);
}

export function getWorkOS(): WorkOS {
  if (!isWorkOsConfigured()) {
    throw new WorkOsNotConfiguredError();
  }
  if (!client) {
    client = new WorkOS(process.env['WORKOS_API_KEY']!, {
      clientId: process.env['WORKOS_CLIENT_ID']!,
    });
  }
  return client;
}

/**
 * Thrown instead of a generic Error so routes can answer 503 ("this feature
 * isn't turned on here") rather than 500 ("we broke") when WorkOS simply
 * hasn't been configured for the deployment.
 */
export class WorkOsNotConfiguredError extends Error {
  readonly status = 503;
  constructor() {
    super(
      'WorkOS is not configured. Set WORKOS_API_KEY and WORKOS_CLIENT_ID ' +
        '(https://dashboard.workos.com → API Keys) to enable SSO and MFA.',
    );
    this.name = 'WorkOsNotConfiguredError';
  }
}

/** Redirect URI for the SSO handshake. Must match one registered in the WorkOS dashboard exactly. */
export function ssoRedirectUri(): string {
  return (
    process.env['WORKOS_REDIRECT_URI'] ??
    `${process.env['NEXTAUTH_URL'] ?? 'http://localhost:3001'}/api/auth/sso/callback`
  );
}

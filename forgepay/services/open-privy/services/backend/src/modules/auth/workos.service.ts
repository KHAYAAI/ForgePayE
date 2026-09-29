import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { WorkOS } from '@workos-inc/node';
import { logger } from '../../common/logger';

export interface WorkOsAuthResult {
  workosUserId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  emailVerified: boolean;
  organizationId: string | null;
}

/**
 * Thin wrapper around the WorkOS AuthKit (User Management) API.
 *
 * WorkOS is the identity provider (hosted login: email/password, social,
 * enterprise SSO, MFA). After a successful login we mint OpenPrivy's own JWT
 * (see AuthService), so the rest of the app's auth — the JwtAuthGuard and the
 * `userId` that wallets/transactions key on — is unchanged.
 *
 * The SDK is only constructed when WORKOS_API_KEY is present, so the app still
 * boots locally without WorkOS configured; the routes then return 503.
 */
@Injectable()
export class WorkOsService {
  private client: WorkOS | null = null;
  private readonly clientId: string;
  private readonly redirectUri: string;

  constructor() {
    const apiKey = process.env.WORKOS_API_KEY;
    this.clientId = process.env.WORKOS_CLIENT_ID || '';
    this.redirectUri = process.env.WORKOS_REDIRECT_URI || '';

    if (apiKey && this.clientId) {
      this.client = new WorkOS(apiKey);
      logger.info('WorkOS AuthKit configured');
    } else {
      logger.warn('WORKOS_API_KEY/WORKOS_CLIENT_ID not set — WorkOS auth routes disabled');
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  private require(): WorkOS {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'WorkOS auth is not configured (set WORKOS_API_KEY and WORKOS_CLIENT_ID)',
      );
    }
    return this.client;
  }

  /**
   * Build the AuthKit hosted-login URL to redirect the browser to.
   * `state` is an opaque value round-tripped back to the callback (CSRF guard).
   */
  getAuthorizationUrl(state: string, organizationId?: string): string {
    return this.require().userManagement.getAuthorizationUrl({
      provider: 'authkit',
      clientId: this.clientId,
      redirectUri: this.redirectUri,
      state,
      ...(organizationId ? { organizationId } : {}),
    });
  }

  /**
   * Exchange the authorization code from the callback for the authenticated
   * user profile.
   */
  async authenticateWithCode(code: string): Promise<WorkOsAuthResult> {
    const res = await this.require().userManagement.authenticateWithCode({
      clientId: this.clientId,
      code,
    });

    const user = res.user;
    return {
      workosUserId: user.id,
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      emailVerified: user.emailVerified ?? false,
      organizationId: (res as { organizationId?: string }).organizationId ?? null,
    };
  }
}

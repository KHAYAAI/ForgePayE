import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getNextAuthSecret } from './nextauth-secret';
import { createSession, getValidSession } from './sessions';
import { logAuditEvent, clientIp } from './audit';

/**
 * Merchant authentication.
 *
 * Previously `authorize()` only ever compared the submitted credentials to
 * a single hardcoded admin email/password pair (DASHBOARD_ADMIN_EMAIL /
 * DASHBOARD_ADMIN_PASSWORD, plaintext, not hashed) and, on a match, returned
 * a fixed `id: 'merchant-1'` — the only identity this login path could ever
 * produce. Meanwhile POST /api/auth/signup genuinely registers a new
 * merchant against mor-layer (bcrypt-hashed password, its own row, its own
 * Hyperswitch api_key) — but nothing here ever checked a real merchant's
 * credentials against that record, so no merchant who signed up could ever
 * log back in as themselves; only the one shared admin credential worked at
 * all, and it always logged everyone in as the same generic identity.
 *
 * authorize() now calls mor-layer's real auth: POST /v1/auth/token (bcrypt-
 * verified, rate-limited) for a JWT, then GET /v1/merchants/me (Bearer-
 * authed) for that merchant's own name and Hyperswitch api_key. There is no
 * separate admin/backdoor credential path — an operator who needs dashboard
 * access registers a real merchant account the same way a customer does.
 */

// Extend next-auth types to carry the merchant's Hyperswitch API key and session id in the JWT.
declare module 'next-auth' {
  interface Session {
    user: {
      id:        string;
      email:     string;
      name?:     string | null;
      apiKey:    string;
      sessionId: string;
    };
  }
  interface User {
    id:     string;
    email:  string;
    name?:  string | null;
    apiKey: string;
  }
}
declare module 'next-auth/jwt' {
  interface JWT {
    apiKey:    string;
    sessionId: string;
  }
}

interface MorTokenResponse {
  access_token: string;
  token_type: string;
}

interface MorMerchantProfile {
  id: string;
  email: string;
  name: string;
  api_key: string;
}

function morLayerUrl(): string {
  return process.env['MOR_LAYER_URL'] ?? 'http://localhost:8010';
}

async function authenticateWithMorLayer(email: string, password: string): Promise<MorMerchantProfile | null> {
  let tokenRes: Response;
  try {
    tokenRes = await fetch(`${morLayerUrl()}/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: email, password }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error('[auth] mor-layer login request failed:', err);
    return null;
  }
  if (!tokenRes.ok) return null; // wrong credentials, or mor-layer rejected the attempt (rate limit, etc.)

  const { access_token: accessToken } = (await tokenRes.json()) as MorTokenResponse;

  let meRes: Response;
  try {
    meRes = await fetch(`${morLayerUrl()}/v1/merchants/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error('[auth] mor-layer profile fetch failed:', err);
    return null;
  }
  if (!meRes.ok) return null;

  return (await meRes.json()) as MorMerchantProfile;
}

export const authOptions: NextAuthOptions = {
  secret: getNextAuthSecret(),
  session: { strategy: 'jwt' },
  pages: {
    signIn:  '/login',
    newUser: '/signup',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          await logAuditEvent({
            actorEmail: credentials?.email,
            action: 'auth.login_failed',
            detail: { reason: 'missing_credentials' },
          });
          return null;
        }

        const merchant = await authenticateWithMorLayer(credentials.email, credentials.password);
        if (!merchant) {
          await logAuditEvent({
            actorEmail: credentials.email,
            action: 'auth.login_failed',
            detail: { reason: 'invalid_credentials' },
          });
          return null;
        }

        return {
          id:     merchant.id,
          email:  merchant.email,
          name:   merchant.name,
          apiKey: merchant.api_key,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.apiKey = (user as { apiKey: string }).apiKey;
        // Create a database session for this JWT
        try {
          const { sessionId } = await createSession(user.id);
          token.sessionId = sessionId;
          await logAuditEvent({
            merchantId: user.id,
            actorMerchantId: user.id,
            actorEmail: (user as { email: string }).email,
            action: 'auth.login_success',
          });
        } catch (err) {
          console.error('[auth] failed to create session:', err);
        }
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.apiKey = token.apiKey;
        session.user.sessionId = (token as any).sessionId;
      }
      return session;
    },
  },
};

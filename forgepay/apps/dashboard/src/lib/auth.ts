import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getNextAuthSecret } from './nextauth-secret';
import { createSession } from './sessions';
import { logAuditEvent } from './audit';
import { ensureLocalMerchant, getMerchantById } from './merchants';
import { getMerchantMfaState, verifyTotpCode } from './workos-mfa';
import { consumeBackupCode } from './mfa';
import { redeemSsoTicket } from './sso-ticket';

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
 *
 * Second factor: once the password check passes, a merchant with MFA enabled
 * must also answer a TOTP challenge (verified by WorkOS, which holds the
 * secret) or spend a backup code before any session is minted. The password
 * step alone never produces a session for such a merchant.
 *
 * The two MFA outcomes are signalled by throwing — NextAuth surfaces a thrown
 * error's message to the client as `res.error`, which is the only way to tell
 * the login page "ask for a code" apart from "those credentials are wrong"
 * (returning null collapses both into a generic CredentialsSignin):
 *   MFA_REQUIRED — password was right; show the code field
 *   MFA_INVALID  — code was wrong; keep the field, say so
 */

/** Password was correct, but a second factor is still owed. */
const MFA_REQUIRED = 'MFA_REQUIRED';
/** A second factor was supplied and did not check out. */
const MFA_INVALID = 'MFA_INVALID';

// Extend next-auth types to carry the merchant's Hyperswitch API key and session id in the JWT.
declare module 'next-auth' {
  interface Session {
    user: {
      id:    string;
      email: string;
      name?: string | null;
      /** Null for SSO-provisioned merchants with no mor-layer record yet — see schema.sql. */
      apiKey:    string | null;
      sessionId: string;
    };
  }
  interface User {
    id:     string;
    email:  string;
    name?:  string | null;
    apiKey: string | null;
  }
}
declare module 'next-auth/jwt' {
  interface JWT {
    apiKey:    string | null;
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
        email:      { label: 'Email',               type: 'email'    },
        password:   { label: 'Password',            type: 'password' },
        totpCode:   { label: 'Authentication code', type: 'text'     },
        backupCode: { label: 'Backup code',         type: 'text'     },
        ssoTicket:  { label: 'SSO ticket',          type: 'text'     },
      },
      async authorize(credentials) {
        // ── SSO hand-off ──────────────────────────────────────────────────
        // The merchant already authenticated against their enterprise IdP;
        // this ticket is the callback's proof of that (single-use, 120s).
        // No password is checked, and no TOTP is demanded: the IdP owns the
        // authentication policy for its own users, which is the point of
        // handing SSO to it. Requiring our second factor on top would mean
        // enforcing a policy the enterprise did not ask us to enforce.
        if (credentials?.ssoTicket) {
          const merchantId = await redeemSsoTicket(credentials.ssoTicket);
          if (!merchantId) {
            await logAuditEvent({
              action: 'auth.login_failed',
              detail: { reason: 'sso_ticket_invalid' },
            });
            return null;
          }

          const merchant = await getMerchantById(merchantId);
          if (!merchant) return null;

          return {
            id:     merchant.id,
            email:  merchant.email,
            name:   merchant.name,
            apiKey: merchant.api_key,
          };
        }

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

        // Mirror the upstream identity locally before anything references it:
        // sessions and audit rows are FK'd to merchants, and the MFA lookup
        // below reads from it.
        await ensureLocalMerchant({
          id:     merchant.id,
          email:  merchant.email,
          name:   merchant.name,
          apiKey: merchant.api_key,
        });

        const mfa = await getMerchantMfaState(merchant.id);
        if (mfa.enabled && mfa.factorId) {
          const totpCode   = credentials.totpCode?.trim();
          const backupCode = credentials.backupCode?.trim();

          if (!totpCode && !backupCode) {
            // Deliberately not an audit "failure": the password was correct
            // and nothing suspicious happened — the flow is simply incomplete.
            throw new Error(MFA_REQUIRED);
          }

          const proved = backupCode
            ? await consumeBackupCode(merchant.id, backupCode)
            : await verifyTotpCode(mfa.factorId, totpCode!);

          if (!proved) {
            await logAuditEvent({
              merchantId:      merchant.id,
              actorMerchantId: merchant.id,
              actorEmail:      merchant.email,
              action:          'mfa.challenge_failed',
              detail:          { stage: 'login', via: backupCode ? 'backup_code' : 'totp' },
            });
            throw new Error(MFA_INVALID);
          }
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

        // Every JWT is backed by a sessions row whose id it carries as
        // `sessionId`; that row is what "log out everywhere" and per-session
        // revocation actually flip. A JWT minted without one would be valid
        // for its full 7-day life with no way to revoke it — so a failure
        // here fails the login rather than quietly issuing an unrevocable
        // token.
        const { sessionId } = await createSession(user.id);
        token.sessionId = sessionId;

        await logAuditEvent({
          merchantId:      user.id,
          actorMerchantId: user.id,
          actorEmail:      (user as { email: string }).email,
          action:          'auth.login_success',
          resource:        sessionId,
        });
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        // NextAuth builds session.user as { name, email, image } and nothing
        // else — there is no id unless it is put there. The merchant id rides
        // in the JWT's standard `sub` claim (set from user.id when the token
        // is minted), so map it across. Without this every route that scopes
        // a query by session.user.id silently works on `undefined`: the type
        // augmentation below promises a string, so nothing would flag it.
        session.user.id        = token.sub!;
        session.user.apiKey    = token.apiKey;
        session.user.sessionId = token.sessionId;
      }
      return session;
    },
  },
};

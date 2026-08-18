import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { query, queryOne, execute } from './db';

import type { Role } from './rbac';

export interface TokenPayload {
  userId: string;
  email: string;
  tenantId: string;
  role: Role;
  /** Session id — matches sessions.id. Lets a session be revoked before the JWT's own expiry. */
  jti: string;
  iat?: number;
  exp?: number;
}

import { getJwtSecret } from './jwt-secret';

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRY = '7d';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MFA_PENDING_EXPIRY = '5m';

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Verify a JWT's signature and expiry only. This does NOT check whether the
 * session it names has been revoked — a logged-out or force-revoked session
 * still passes this check until its 7-day expiry. Use getCurrentUser() (or
 * getValidSession()) for anything that should actually respect revocation;
 * this exists for the edge middleware's fast routing-gate path, where a
 * signature check is the only thing cheaply available (see middleware.ts's
 * own doc comment for why the DB check can't live there on Next 14).
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

// ── Sessions ────────────────────────────────────────────────────────────────

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  last_seen_at: Date;
  ip_address: string | null;
  user_agent: string | null;
}

export interface SessionContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Issue a new session: a sessions row plus a JWT whose `jti` names it.
 * This is the only place a full auth-token JWT is minted — always creates a
 * durable, revocable record, never a bare stateless token.
 */
export async function createSession(
  payload: Omit<TokenPayload, 'iat' | 'exp' | 'jti'>,
  ctx: SessionContext = {},
): Promise<{ token: string; sessionId: string }> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await query(
    `INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, payload.userId, expiresAt, ctx.ipAddress ?? null, ctx.userAgent ?? null],
  );

  const token = jwt.sign({ ...payload, jti: sessionId }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  return { token, sessionId };
}

/**
 * The real "is this session actually valid right now" check: signature,
 * expiry, AND not revoked. Touches last_seen_at best-effort (never blocks
 * the caller on it) so the sessions list can show real recency.
 */
export async function getValidSession(token: string): Promise<TokenPayload | null> {
  const payload = verifyToken(token);
  if (!payload?.jti) return null;

  const session = await queryOne<SessionRow>(
    `SELECT * FROM sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [payload.jti],
  );
  if (!session) return null;

  void execute(`UPDATE sessions SET last_seen_at = NOW() WHERE id = $1`, [payload.jti]).catch((err) =>
    console.error('[auth] failed to touch session last_seen_at:', err),
  );

  return payload;
}

export async function getCurrentUser(): Promise<TokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth-token')?.value;
  if (!token) return null;
  return getValidSession(token);
}

/** The current request's session id, if any — for "revoke every session except this one". */
export async function getCurrentSessionId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.jti ?? null;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await execute(`UPDATE sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
}

/** Revoke every active session for a user. Pass `exceptSessionId` to keep the caller's own session alive. */
export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  if (exceptSessionId) {
    return execute(
      `UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND id != $2 AND revoked_at IS NULL`,
      [userId, exceptSessionId],
    );
  }
  return execute(`UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}

/** Active (non-revoked, non-expired) sessions for a user, most recent first — the "Sessions" settings panel. */
export async function listActiveSessions(userId: string): Promise<SessionRow[]> {
  return query<SessionRow>(
    `SELECT * FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY last_seen_at DESC`,
    [userId],
  );
}

export async function getSessionById(sessionId: string): Promise<SessionRow | null> {
  return queryOne<SessionRow>(`SELECT * FROM sessions WHERE id = $1`, [sessionId]);
}

// ── MFA-pending tokens ────────────────────────────────────────────────────────
// A user with MFA enabled doesn't get a full session on password-check alone
// — login() below issues one of these short-lived tokens instead, and the
// real session (createSession) is only minted after POST /api/auth/mfa/verify
// confirms a TOTP or backup code. Deliberately NOT a `sessions` row: it's not
// a session, just a 5-minute "this password check passed" receipt.

interface MfaPendingPayload {
  userId: string;
  mfaPending: true;
  iat?: number;
  exp?: number;
}

export function generateMfaPendingToken(userId: string): string {
  return jwt.sign({ userId, mfaPending: true }, JWT_SECRET, { expiresIn: MFA_PENDING_EXPIRY });
}

export function verifyMfaPendingToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as MfaPendingPayload;
    if (decoded.mfaPending !== true) return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}

export async function setMfaPendingCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set('mfa-pending-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 5 * 60,
  });
}

export async function getMfaPendingToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get('mfa-pending-token')?.value ?? null;
}

export async function clearMfaPendingCookie() {
  const cookieStore = await cookies();
  cookieStore.delete('mfa-pending-token');
}

// ── Cookies ───────────────────────────────────────────────────────────────────

export async function setAuthCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set('auth-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

export async function clearAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete('auth-token');
}

// ── Users ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  tenant_id: string;
  api_key: string;
  role: Role;
  status: 'active' | 'inactive';
  totp_secret: string | null;
  totp_enabled: boolean;
  totp_backup_codes: string[];
  created_at: Date;
  updated_at: Date;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return queryOne<User>(
    `SELECT * FROM users WHERE email = $1 AND status = 'active'`,
    [email]
  );
}

export async function getUserById(userId: string): Promise<User | null> {
  return queryOne<User>(
    `SELECT * FROM users WHERE id = $1 AND status = 'active'`,
    [userId]
  );
}

export async function createUser(
  email: string,
  name: string,
  passwordHash: string,
  tenantId: string,
  role: Role = 'analyst'
): Promise<User> {
  const userId = crypto.randomUUID();
  const apiKey = crypto.randomUUID();

  const result = await queryOne<User>(
    `INSERT INTO users (id, email, name, password_hash, tenant_id, api_key, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW())
     RETURNING *`,
    [userId, email, name, passwordHash, tenantId, apiKey, role]
  );

  if (!result) throw new Error('Failed to create user');
  return result;
}

/**
 * First-ever SSO login for a person provisions their user row on the spot
 * (their identity was just proven by the enterprise's own IdP via WorkOS —
 * there's nothing left to verify). New SSO users default to the
 * least-privileged role, same as password signup; someone with manage:team
 * can promote them from there. A random, never-used password hash fills the
 * NOT NULL column — SSO users authenticate exclusively via SSO, this value
 * is unreachable through the password login path once used for that
 * purpose (nothing generates a matching plaintext to check it against).
 */
export async function findOrCreateSsoUser(
  email: string,
  name: string,
  tenantId: string,
): Promise<User> {
  const existing = await getUserByEmail(email);
  if (existing) return existing;

  const passwordHash = await hashPassword(randomUUID());
  return createUser(email, name, passwordHash, tenantId, 'analyst');
}

export async function generateApiKey(userId: string): Promise<string> {
  const newApiKey = crypto.randomUUID();
  await query(
    `UPDATE users SET api_key = $1, updated_at = NOW() WHERE id = $2`,
    [newApiKey, userId]
  );
  return newApiKey;
}

export async function verifyApiKey(apiKey: string): Promise<User | null> {
  return queryOne<User>(
    `SELECT * FROM users WHERE api_key = $1 AND status = 'active'`,
    [apiKey]
  );
}

// ── MFA enrollment state ────────────────────────────────────────────────────

/** Persist a freshly-generated TOTP secret. Enrollment isn't complete — totp_enabled stays false until confirmTotpEnrollment(). */
export async function setPendingTotpSecret(userId: string, secret: string): Promise<void> {
  await execute(`UPDATE users SET totp_secret = $1, updated_at = NOW() WHERE id = $2`, [secret, userId]);
}

/** Flip totp_enabled on and store the (hashed) backup codes, once the user has proven they can generate a real code. */
export async function confirmTotpEnrollment(userId: string, backupCodeHashes: string[]): Promise<void> {
  await execute(
    `UPDATE users SET totp_enabled = true, totp_backup_codes = $1, updated_at = NOW() WHERE id = $2`,
    [backupCodeHashes, userId],
  );
}

export async function disableTotp(userId: string): Promise<void> {
  await execute(
    `UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_backup_codes = '{}', updated_at = NOW() WHERE id = $1`,
    [userId],
  );
}

export async function replaceBackupCodeHashes(userId: string, hashes: string[]): Promise<void> {
  await execute(`UPDATE users SET totp_backup_codes = $1, updated_at = NOW() WHERE id = $2`, [hashes, userId]);
}

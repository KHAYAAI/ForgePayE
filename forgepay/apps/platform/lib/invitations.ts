import { createHash, randomBytes, randomUUID } from 'crypto';
import { query, queryOne, transaction } from './db';
import type { Role } from './rbac';
import { createUser, hashPassword, User } from './auth';

export const INVITABLE_ROLES = ['admin', 'approver', 'analyst'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

const TTL_MS = 7 * 24 * 3600 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * The configured public URL wins (set NEXT_PUBLIC_APP_URL in production so a
 * forged Host header can't redirect invitees); otherwise use the origin the
 * inviter is actually browsing, which is right for local and preview setups.
 */
export function inviteLink(token: string, requestOrigin: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || requestOrigin;
  return `${base.replace(/\/$/, '')}/auth/accept-invite?token=${token}`;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: InvitableRole;
  invited_by: string;
  created_at: string;
  expires_at: string;
}

export async function listPending(tenantId: string): Promise<InvitationRow[]> {
  return query<InvitationRow>(
    `SELECT id, email, role, invited_by, created_at, expires_at FROM invitations
      WHERE tenant_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC`,
    [tenantId],
  );
}

export class InviteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Create an invitation; returns the raw token, which is never retrievable again. */
export async function createInvitation(
  tenantId: string,
  email: string,
  role: InvitableRole,
  invitedBy: string,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const address = email.trim().toLowerCase();
  const existing = await queryOne(`SELECT 1 FROM users WHERE lower(email) = $1`, [address]);
  if (existing) throw new InviteError(409, 'That email already has an account.');

  const token = randomBytes(32).toString('hex');
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + TTL_MS);
  await transaction(async (client) => {
    // Re-inviting replaces the earlier link rather than leaving two live ones.
    await client.query(
      `UPDATE invitations SET revoked_at = NOW()
        WHERE tenant_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [tenantId, address],
    );
    await client.query(
      `INSERT INTO invitations (id, tenant_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, tenantId, address, role, hashToken(token), invitedBy, expiresAt],
    );
  });
  return { id, token, expiresAt };
}

export async function revokeInvitation(tenantId: string, id: string): Promise<boolean> {
  const rows = await query(
    `UPDATE invitations SET revoked_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [id, tenantId],
  );
  return rows.length > 0;
}

/** Look up a usable invitation by raw token, for the accept page. */
export async function lookupInvitation(token: string) {
  return queryOne<{ id: string; tenant_id: string; email: string; role: InvitableRole; tenant_name: string; sso_required: boolean }>(
    `SELECT i.id, i.tenant_id, i.email, i.role, t.name AS tenant_name, t.sso_required
       FROM invitations i JOIN tenants t ON t.id = i.tenant_id
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()`,
    [hashToken(token)],
  );
}

/**
 * Accept: single-use, race-safe. The UPDATE ... WHERE accepted_at IS NULL is
 * what makes two simultaneous accepts produce exactly one user.
 */
export async function acceptInvitation(token: string, name: string, password: string): Promise<User> {
  const invite = await lookupInvitation(token);
  if (!invite) throw new InviteError(410, 'This invitation is invalid, expired, or already used.');
  if (invite.sso_required) throw new InviteError(403, 'This workspace requires single sign-on; password sign-up is disabled.');
  const passwordHash = await hashPassword(password);

  return transaction(async (client) => {
    const claimed = await client.query(
      `UPDATE invitations SET accepted_at = NOW()
        WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW() RETURNING id`,
      [invite.id],
    );
    if (claimed.rowCount === 0) throw new InviteError(410, 'This invitation is invalid, expired, or already used.');
    const taken = await client.query(`SELECT 1 FROM users WHERE lower(email) = $1`, [invite.email]);
    if (taken.rowCount) throw new InviteError(409, 'That email already has an account.');
    const userId = randomUUID();
    const { rows } = await client.query<User>(
      `INSERT INTO users (id, email, name, password_hash, tenant_id, api_key, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW()) RETURNING *`,
      [userId, invite.email, name, passwordHash, invite.tenant_id, randomUUID(), invite.role as Role],
    );
    return rows[0];
  });
}

/**
 * ForgePay Console — Role-Based Access Control
 * ─────────────────────────────────────────────
 * Least-privilege roles for the merchant/institution console. Custody
 * signing is a separate governed grant enforced by the Custody service's
 * own quorum — these roles gate what a user can see and do in the console.
 */

export type Role = 'owner' | 'admin' | 'approver' | 'analyst';

export const ROLES: Role[] = ['owner', 'admin', 'approver', 'analyst'];

/** Every distinct capability the console gates. */
export type Permission =
  | 'view:dashboard'
  | 'manage:team'          // invite/remove users, change roles
  | 'manage:api_keys'      // create/rotate/revoke API keys
  | 'manage:billing'
  | 'approve:credit'       // send credit-line extensions to treasury
  | 'approve:payouts'      // dual-control payout / refund release
  | 'manage:custody_policy'// propose custody governance changes
  | 'view:audit'
  | 'admin:all';           // superuser (owner only)

const MATRIX: Record<Role, Permission[]> = {
  owner: [
    'view:dashboard', 'manage:team', 'manage:api_keys', 'manage:billing',
    'approve:credit', 'approve:payouts', 'manage:custody_policy', 'view:audit', 'admin:all',
  ],
  admin: [
    'view:dashboard', 'manage:team', 'manage:api_keys', 'manage:billing',
    'approve:credit', 'approve:payouts', 'manage:custody_policy', 'view:audit',
  ],
  approver: [
    'view:dashboard', 'approve:credit', 'approve:payouts', 'view:audit',
  ],
  analyst: [
    'view:dashboard', 'view:audit',
  ],
};

/** Does this role hold this permission? */
export function can(role: Role | string | undefined, permission: Permission): boolean {
  if (!role || !(role in MATRIX)) return false;
  return MATRIX[role as Role].includes(permission);
}

/** Console routes that require a permission beyond plain view:dashboard. */
export const ROUTE_PERMISSIONS: Array<{ prefix: string; permission: Permission }> = [
  { prefix: '/dashboard/admin',    permission: 'manage:team' },
  { prefix: '/dashboard/api-keys', permission: 'manage:api_keys' },
];

/** Resolve the tightest permission gate for a path, if any. */
export function requiredPermissionFor(pathname: string): Permission | null {
  const match = ROUTE_PERMISSIONS.find((r) => pathname.startsWith(r.prefix));
  return match ? match.permission : null;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as string[]).includes(value);
}

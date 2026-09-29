/**
 * POST /api/forge/custody-action — every custody write from the console.
 * The acting person is always the signed-in user; the browser can't choose it.
 *
 * openfireblocks decides whether that person is an active signer. This route
 * adds what only the console knows — the user's role — so a view-only
 * teammate can't make themselves the workspace's first signer, and only
 * people whose role may approve money movement can be added as signers.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getEnabledProducts } from '@/lib/products';
import { can, Permission } from '@/lib/rbac';
import { queryOne } from '@/lib/db';
import { CustodyAction, OpenFireblocksError, performCustodyAction } from '@/lib/openfireblocks';

export const dynamic = 'force-dynamic';

const NEEDS: Record<CustodyAction['action'], Permission> = {
  bootstrap_signer: 'manage:custody_policy',
  propose: 'manage:custody_policy',
  vote: 'approve:payouts',
  transfer: 'approve:payouts',
  issue_api_key: 'manage:api_keys',
  revoke_api_key: 'manage:api_keys',
};

const deny = (message: string, status = 403) => NextResponse.json({ message }, { status });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return deny('Unauthorized', 401);
  if (!(await getEnabledProducts(user.tenantId)).includes('custody')) {
    return deny('Custody is not enabled for this account');
  }

  const body = (await req.json().catch(() => null)) as CustodyAction | null;
  if (!body || !(body.action in NEEDS)) return deny('unknown custody action', 400);

  const needed = NEEDS[body.action];
  if (!can(user.role, needed)) {
    return deny(`Your role (${user.role}) can't do this. It needs the ${needed} permission.`);
  }

  // A proposed signer must be an active teammate whose role may approve
  // payouts — otherwise the roster could hold people who can't log in, or
  // whom the role model says shouldn't move money.
  if (body.action === 'propose' && body.kind === 'add_signer') {
    const email = String((body.payload as { email?: unknown })?.email ?? '').toLowerCase();
    const member = await queryOne<{ role: string }>(
      `SELECT role FROM users WHERE tenant_id = $1 AND lower(email) = $2 AND status = 'active'`,
      [user.tenantId, email],
    );
    if (!member) return deny(`${email} isn't on your team. Invite them from Admin first.`, 400);
    if (!can(member.role, 'approve:payouts')) {
      return deny(`${email} is an ${member.role}, and that role can't approve payouts. Change their role or pick someone else.`, 400);
    }
  }

  try {
    return NextResponse.json({ data: await performCustodyAction(user.tenantId, user.email.toLowerCase(), body) });
  } catch (err) {
    if (err instanceof OpenFireblocksError) return deny(err.message, err.status);
    return deny('Custody service unreachable', 502);
  }
}

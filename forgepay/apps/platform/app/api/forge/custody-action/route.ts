/**
 * POST /api/forge/custody-action — every custody write from the console.
 * The acting person is always the signed-in user; the browser can't choose it.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getEnabledProducts } from '@/lib/products';
import { CustodyAction, OpenFireblocksError, performCustodyAction } from '@/lib/openfireblocks';

export const dynamic = 'force-dynamic';

const ACTIONS = new Set(['bootstrap_signer', 'propose', 'vote', 'transfer', 'issue_api_key', 'revoke_api_key']);

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!(await getEnabledProducts(user.tenantId)).includes('custody')) {
    return NextResponse.json({ message: 'Custody is not enabled for this account' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as CustodyAction | null;
  if (!body || !ACTIONS.has(body.action)) {
    return NextResponse.json({ message: 'unknown custody action' }, { status: 400 });
  }

  try {
    return NextResponse.json({ data: await performCustodyAction(user.tenantId, user.email.toLowerCase(), body) });
  } catch (err) {
    if (err instanceof OpenFireblocksError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Custody service unreachable' }, { status: 502 });
  }
}

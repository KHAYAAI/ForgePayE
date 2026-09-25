/**
 * Console data proxy — PUT /api/forge/bureau-disputes/:id
 *
 * Advances or resolves one dispute. A write, called once per action from the
 * Disputes page — never polled.
 */

import { NextResponse } from 'next/server';
import { putBureauDispute } from '@/lib/forge-services';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const body = (await req.json().catch(() => null)) as { status?: string; resolution?: string } | null;
  if (!body?.status) {
    return NextResponse.json({ live: false, data: null, error: 'missing status' }, { status: 400 });
  }
  return NextResponse.json(await putBureauDispute(params.id, { status: body.status, resolution: body.resolution }));
}

/**
 * Console data proxy — GET /api/forge/:section
 *
 * Sections: custody | wallet | treasury | bureau | bureau-agent-detail |
 * bureau-scores | bureau-disputes | ontology | overview | payments
 *
 * Always returns 200 with { live, data } — a dead service is a normal
 * state the console renders (fallback to demo fixtures), not an error.
 */

import { NextResponse } from 'next/server';
import {
  getBureauAgentDetail,
  getBureauDisputes,
  getBureauDualScores,
  getBureauStats,
  getMerchantSummary,
  getOntologyEvents,
  getTreasurySummary,
} from '@/lib/forge-services';
import { getWalletSummary } from '@/lib/openprivy';
import { getCustodyConsole } from '@/lib/openfireblocks';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: { section: string } },
) {
  switch (params.section) {
    case 'custody': {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ live: false, data: null, error: 'unauthenticated' }, { status: 401 });
      const result = await getCustodyConsole(user.tenantId);
      return NextResponse.json(
        result.live ? { ...result, data: { ...(result.data as object), viewer: user.email.toLowerCase() } } : result,
      );
    }
    case 'wallet': {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ live: false, data: null, error: 'unauthenticated' }, { status: 401 });
      return NextResponse.json(await getWalletSummary(user.tenantId));
    }
    case 'treasury':
      return NextResponse.json(await getTreasurySummary());
    case 'payments': {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ live: false, data: null, error: 'unauthenticated' }, { status: 401 });
      return NextResponse.json(await getMerchantSummary(user.email));
    }
    case 'bureau':
      return NextResponse.json(await getBureauStats());
    case 'bureau-agent-detail': {
      const agentId = new URL(req.url).searchParams.get('agentId');
      if (!agentId) return NextResponse.json({ live: false, data: null, error: 'missing agentId' }, { status: 400 });
      return NextResponse.json(await getBureauAgentDetail(agentId));
    }
    case 'bureau-scores':
      return NextResponse.json(await getBureauDualScores());
    case 'bureau-disputes':
      return NextResponse.json(await getBureauDisputes());
    case 'ontology':
      return NextResponse.json(await getOntologyEvents());
    case 'overview': {
      // Cross-platform aggregate for the unified dashboard.
      const overviewUser = await getCurrentUser();
      const [custody, wallet, treasury, bureau, ontology] = await Promise.all([
        overviewUser
          ? getCustodyConsole(overviewUser.tenantId)
          : Promise.resolve({ live: false, data: null, error: 'unauthenticated' }),
        overviewUser
          ? getWalletSummary(overviewUser.tenantId)
          : Promise.resolve({ live: false, data: null, error: 'unauthenticated' }),
        getTreasurySummary<Record<string, unknown>>(),
        getBureauStats<Record<string, unknown>>(),
        getOntologyEvents<Record<string, unknown>>(),
      ]);
      const anyLive = [custody, wallet, treasury, bureau, ontology].some((r) => r.live);
      return NextResponse.json({
        live: anyLive,
        data: { custody, wallet, treasury, bureau, ontology },
      });
    }
    default:
      return NextResponse.json({ live: false, data: null, error: 'unknown_section' }, { status: 404 });
  }
}

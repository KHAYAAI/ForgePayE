/**
 * Console data proxy — GET /api/forge/:section
 *
 * Sections: custody | wallet | treasury | bureau | bureau-agent-detail |
 * bureau-scores | bureau-disputes | ontology | overview | payments
 *
 * Always returns 200 with { live, data } — a dead service is a normal
 * state the console renders (fallback to demo fixtures), not an error.
 */

import { guardRoute } from '@/lib/route-guard';
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
import { getEnabledProducts } from '@/lib/products';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: { section: string } },
) {
  switch (params.section) {
    case 'custody': {
      const g = await guardRoute({ product: 'custody' });
      if ('response' in g) return g.response;
      const user = g.user;
      const result = await getCustodyConsole(user.tenantId);
      return NextResponse.json(
        result.live ? { ...result, data: { ...(result.data as object), viewer: user.email.toLowerCase() } } : result,
      );
    }
    case 'wallet': {
      const g = await guardRoute({ product: 'wallet' });
      if ('response' in g) return g.response;
      const user = g.user;
      return NextResponse.json(await getWalletSummary(user.tenantId));
    }
    case 'treasury': {
      const g = await guardRoute({ product: 'treasury' });
      if ('response' in g) return g.response;
      return NextResponse.json(await getTreasurySummary());
    }
    case 'payments': {
      const g = await guardRoute({ product: 'payments' });
      if ('response' in g) return g.response;
      const user = g.user;
      return NextResponse.json(await getMerchantSummary(user.email));
    }
    case 'bureau': {
      const g = await guardRoute({ product: 'credit-bureau' });
      if ('response' in g) return g.response;
      return NextResponse.json(await getBureauStats(g.user.tenantId));
    }
    case 'bureau-agent-detail': {
      const g = await guardRoute({ product: 'credit-bureau' });
      if ('response' in g) return g.response;
      const agentId = new URL(req.url).searchParams.get('agentId');
      if (!agentId) return NextResponse.json({ live: false, data: null, error: 'missing agentId' }, { status: 400 });
      return NextResponse.json(await getBureauAgentDetail(g.user.tenantId, agentId));
    }
    case 'bureau-scores': {
      const g = await guardRoute({ product: 'credit-bureau' });
      if ('response' in g) return g.response;
      return NextResponse.json(await getBureauDualScores(g.user.tenantId));
    }
    case 'bureau-disputes': {
      const g = await guardRoute({ product: 'credit-bureau' });
      if ('response' in g) return g.response;
      return NextResponse.json(await getBureauDisputes(g.user.tenantId));
    }
    case 'ontology': {
      const g = await guardRoute();
      if ('response' in g) return g.response;
      return NextResponse.json(await getOntologyEvents(g.user.tenantId));
    }
    case 'overview': {
      // Cross-platform aggregate for the unified dashboard. Each panel goes
      // through the same product gate as its own section, so the overview is
      // not a back door to a product this workspace has not been given.
      const overviewUser = await getCurrentUser();
      const off = (error: string) => Promise.resolve({ live: false, data: null, error });
      if (!overviewUser) {
        return NextResponse.json({ live: false, data: null, error: 'unauthenticated' }, { status: 401 });
      }
      const tenantId = overviewUser.tenantId;
      const enabled = new Set(await getEnabledProducts(tenantId));
      const [custody, wallet, treasury, bureau, ontology] = await Promise.all([
        enabled.has('custody') ? getCustodyConsole(tenantId) : off('product not enabled'),
        enabled.has('wallet') ? getWalletSummary(tenantId) : off('product not enabled'),
        enabled.has('treasury') ? getTreasurySummary<Record<string, unknown>>() : off('product not enabled'),
        enabled.has('credit-bureau') ? getBureauStats<Record<string, unknown>>(tenantId) : off('product not enabled'),
        getOntologyEvents<Record<string, unknown>>(tenantId),
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

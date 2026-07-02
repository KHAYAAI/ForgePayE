/**
 * Console data proxy — GET /api/forge/:section
 *
 * Sections: custody | wallet | treasury | bureau | ontology | overview
 *
 * Always returns 200 with { live, data } — a dead service is a normal
 * state the console renders (fallback to demo fixtures), not an error.
 */

import { NextResponse } from 'next/server';
import {
  getBureauStats,
  getCustodySummary,
  getOntologyEvents,
  getTreasurySummary,
  getWalletSummary,
} from '@/lib/forge-services';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { section: string } },
) {
  switch (params.section) {
    case 'custody':
      return NextResponse.json(await getCustodySummary());
    case 'wallet':
      return NextResponse.json(await getWalletSummary());
    case 'treasury':
      return NextResponse.json(await getTreasurySummary());
    case 'bureau':
      return NextResponse.json(await getBureauStats());
    case 'ontology':
      return NextResponse.json(await getOntologyEvents());
    case 'overview': {
      // Cross-platform aggregate for the unified dashboard.
      const [custody, wallet, treasury, bureau, ontology] = await Promise.all([
        getCustodySummary<Record<string, unknown>>(),
        getWalletSummary<Record<string, unknown>>(),
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

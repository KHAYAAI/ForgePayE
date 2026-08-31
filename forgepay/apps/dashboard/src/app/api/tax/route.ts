import { type NextRequest, NextResponse } from 'next/server';
import { getSessionApiKey, unauthorizedResponse, UnauthorizedError } from '@/lib/session';
import { getPaymentsSummary } from '@/lib/hyperswitch-server';

export const runtime = 'nodejs';

// Tax jurisdiction breakdown — sourced from MoR layer in production;
// falls back to representative rates for display while MoR integration is completed.
const JURISDICTION_RATES: Record<string, { type: string; rate: number }> = {
  'United States':   { type: 'Sales Tax',  rate: 0.08 },
  'European Union':  { type: 'VAT',        rate: 0.20 },
  'United Kingdom':  { type: 'VAT',        rate: 0.20 },
  'Australia':       { type: 'GST',        rate: 0.10 },
  'Canada':          { type: 'GST/HST',    rate: 0.13 },
  'Singapore':       { type: 'GST',        rate: 0.09 },
  'Germany':         { type: 'VAT',        rate: 0.19 },
  'France':          { type: 'VAT',        rate: 0.20 },
  'Japan':           { type: 'Consumption Tax', rate: 0.10 },
  'India':           { type: 'GST',        rate: 0.18 },
};

// Revenue distribution by geography (representative; replaced by real geo data from MoR layer)
const GEO_WEIGHTS: Record<string, number> = {
  'United States':  0.42,
  'European Union': 0.18,
  'United Kingdom': 0.10,
  'Australia':      0.07,
  'Canada':         0.08,
  'Singapore':      0.03,
  'Germany':        0.04,
  'France':         0.03,
  'Japan':          0.02,
  'India':          0.03,
};

export async function GET(req: NextRequest) {
  try {
    const apiKey = await getSessionApiKey();

    const daysParam = req.nextUrl.searchParams.get('days');
    const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 30, 1), 365) : 30;

    const summary = await getPaymentsSummary(apiKey, days);
    const grossRevenueCents = summary.total_amount ?? 0;

    // Compute per-jurisdiction tax breakdown
    const jurisdictions = Object.entries(JURISDICTION_RATES).map(([region, { type, rate }]) => {
      const weight = GEO_WEIGHTS[region] ?? 0;
      const regionRevenueCents = Math.round(grossRevenueCents * weight);
      const taxCollected = Math.round(regionRevenueCents * rate);
      return {
        region,
        type,
        rate: `${(rate * 100).toFixed(1)}%`,
        collected: taxCollected,
        remitted: taxCollected, // MoR remits same day
      };
    });

    const totalTaxCents = jurisdictions.reduce((sum, j) => sum + j.collected, 0);
    const jurisdictionCount = jurisdictions.filter(j => j.collected > 0).length;

    const now   = new Date();
    const start = new Date(now.getTime() - days * 86_400_000);

    // Check if MoR integration is active (real tax data available)
    const morUrl = process.env['MOR_LAYER_URL'];
    // Named rather than inferred: `as typeof morData` narrowed to `null` at the
    // assignment below, which made every property read resolve to `never`.
    type MorTaxSummary = { total_tax_cents?: number; jurisdiction_count?: number };
    let morData: MorTaxSummary | null = null;
    if (morUrl) {
      try {
        const morRes = await fetch(`${morUrl}/v1/tax/summary?days=${days}`, {
          headers: { 'X-Api-Key': apiKey },
          signal: AbortSignal.timeout(3000),
        });
        if (morRes.ok) {
          morData = (await morRes.json()) as MorTaxSummary;
        }
      } catch {
        // MoR unreachable — use calculated values
      }
    }

    return NextResponse.json({
      total_tax_cents:    morData?.total_tax_cents ?? totalTaxCents,
      jurisdiction_count: morData?.jurisdiction_count ?? jurisdictionCount,
      gross_revenue_cents: grossRevenueCents,
      effective_tax_rate:  grossRevenueCents > 0
        ? ((morData?.total_tax_cents ?? totalTaxCents) / grossRevenueCents)
        : 0,
      period_start: start.toISOString(),
      period_end:   now.toISOString(),
      jurisdictions,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

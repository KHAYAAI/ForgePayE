'use client';

import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  DataTable,
  LivePill,
  Mono,
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';

/* ────────────────────────────────────────────────────────────────
   FORGE Payments — Overview.
   Pricing comes from forgepay/config/pricing.yaml. No amount-tiered
   routing exists (the router module that described it was retired).
   Live-wired to unified-router's customers/revenue_events, scoped
   to this tenant's own email — see /api/forge/payments. A tenant
   who hasn't activated FORGE Payments yet (no checkout completed)
   sees a real zero state, not illustrative traffic.
   ──────────────────────────────────────────────────────────────── */

interface RecentEvent {
  id: string;
  product: string;
  eventType: string;
  amountUsdCents: number;
  currency: string;
  occurredAt: string;
}

interface MerchantSummary {
  activated: boolean;
  customer: { id: string; email: string; name: string | null; status: string; createdAt: string } | null;
  stats: { events24h: number; eventsTotal: number; revenueUsdCents24h: number; revenueUsdCentsTotal: number };
  recentEvents: RecentEvent[];
}

const EMPTY: MerchantSummary = {
  activated: false,
  customer: null,
  stats: { events24h: 0, eventsTotal: 0, revenueUsdCents24h: 0, revenueUsdCentsTotal: 0 },
  recentEvents: [],
};

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PaymentsOverview() {
  const { data, live } = useForge<MerchantSummary>('payments', EMPTY);

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Payments"
        title={
          <>
            Every payment, <em>one rail</em>
          </>
        }
        lede="Card, bank and stablecoin behind a single API, opening only after licensing. Indicative pricing: Free tier 2.8% + $0.24 per card payment, Standard ($28/month) 2.4% + $0.24 (forgepay/config/pricing.yaml). Every confirmed payment writes one event to the Revenue Ontology."
        actions={<LivePill live={live} />}
      />

      {!data.activated && (
        <Panel title="Not activated yet" label="FORGE Payments" style={{ marginBottom: 20 }}>
          <p className="lede" style={{ fontSize: 13 }}>
            Your account hasn&apos;t completed FORGE Payments checkout yet, so there&apos;s no activity to
            show. Numbers below will start moving the moment your first payment settles.
          </p>
        </Panel>
      )}

      <StatGrid>
        <Stat label="Events / 24h" value={data.stats.events24h} delta={data.activated ? 'from the Revenue Ontology' : 'no activity yet'} />
        <Stat label="Revenue / 24h" value={usd(data.stats.revenueUsdCents24h)} delta="metered activity" />
        <Stat label="Events total" value={data.stats.eventsTotal} delta="since activation" />
        <Stat label="Revenue total" value={usd(data.stats.revenueUsdCentsTotal)} delta="lifetime" />
      </StatGrid>

      <Panel title="Recent Activity" label="revenue_events · newest first">
        <DataTable
          columns={['Event', 'Product', 'Amount', 'When']}
          emptyMessage={data.activated ? 'No events recorded yet.' : 'Activate FORGE Payments to start recording events.'}
          rows={data.recentEvents.map((e) => [
            <Mono key="t">{e.eventType}</Mono>,
            e.product,
            <Mono key="a">{usd(e.amountUsdCents)} {e.currency}</Mono>,
            <Mono key="w">{new Date(e.occurredAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Mono>,
          ])}
        />
      </Panel>

    </>
  );
}

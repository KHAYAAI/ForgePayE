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
   Free platform, take-rate pricing: 2.2% + R0.20 fiat,
   0.8% + gas crypto. Tiered routing: sub-$100K direct,
   $100K–$1M with fallback chain, >$1M escalates to Custody.
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
        lede="Card, bank and stablecoin behind a single API. The platform is free — FORGE earns a take rate of 2.2% + R0.20 on fiat and 0.8% + gas on crypto. Every confirmed payment writes one event to the Revenue Ontology."
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

      <Panel title="Tier Routing Contract" label="enforced on every payment" ink style={{ marginTop: 20 }}>
        <ol style={{ listStyle: 'none' }}>
          {[
            ['< $100K', 'Direct via FORGE Wallet — signed server-side, 12-block confirmation.'],
            ['$100K – $1M', 'FORGE Payments with fallback chain: card → ACH → USDC. No payment dies on a single rail.'],
            ['> $1M', 'Escalates to FORGE Custody — 4-of-7 MPC signing queue, approvals enforced.'],
          ].map(([tier, desc]) => (
            <li key={tier} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid rgba(244,242,238,0.14)', alignItems: 'baseline' }}>
              <span className="mono" style={{ minWidth: 92 }}>{tier}</span>
              <span style={{ fontSize: 13.5, opacity: 0.8 }}>{desc}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}

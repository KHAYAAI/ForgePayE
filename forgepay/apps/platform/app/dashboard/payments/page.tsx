'use client';

import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  Pill,
  DataTable,
  Grid2,
  Meter,
  Mono,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Payments — Overview.
   Free platform, take-rate pricing: 2.2% + R0.20 fiat,
   0.8% + gas crypto. Tiered routing: sub-$100K direct,
   $100K–$1M with fallback chain, >$1M escalates to Custody.
   ──────────────────────────────────────────────────────────────── */

const VOLUME_BY_HOUR = [42, 38, 31, 28, 24, 30, 44, 61, 78, 92, 104, 118, 122, 116, 109, 121, 134, 128, 112, 95, 84, 71, 58, 47];

export default function PaymentsOverview() {
  const max = Math.max(...VOLUME_BY_HOUR);
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
      />

      <StatGrid>
        <Stat label="Transactions / 24h" value="2,847" delta="+12% vs yesterday" deltaTone="up" />
        <Stat label="Volume / 24h" value="R4.2M" delta="R92.4K take-rate revenue" deltaTone="up" />
        <Stat label="Success rate" value="99.7%" delta="0.1% above target" deltaTone="up" />
        <Stat label="Fallback usage" value="0.3%" delta="card → ACH → USDC" />
        <Stat label="Avg settlement" value="2.3s" delta="below 5s SLA" deltaTone="up" />
        <Stat label="Routed to Custody" value="3" delta="above $1M tier" />
      </StatGrid>

      <Panel title="Volume by Hour" label="24h · confirmed payments" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
          {VOLUME_BY_HOUR.map((v, i) => (
            <div
              key={i}
              title={`${String(i).padStart(2, '0')}:00 — ${v} tx`}
              style={{
                flex: 1,
                height: `${(v / max) * 100}%`,
                background: i === new Date().getUTCHours() ? 'var(--ink)' : 'var(--hair)',
                minHeight: 3,
              }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <span className="mono">00:00 UTC</span>
          <span className="mono">23:00 UTC</span>
        </div>
      </Panel>

      <Grid2>
        <Panel title="Success by Method" label="trailing 24h">
          <DataTable
            columns={['Method', 'Share', '', 'Success', 'Avg fee earned']}
            rows={[
              ['Card', <Mono key="s">54%</Mono>, <Meter key="m" pct={54} accent />, <Mono key="r">99.6%</Mono>, <Mono key="f">2.2% + R0.20</Mono>],
              ['Bank / EFT', <Mono key="s">28%</Mono>, <Meter key="m" pct={28} accent />, <Mono key="r">99.8%</Mono>, <Mono key="f">2.2% + R0.20</Mono>],
              ['USDC', <Mono key="s">15%</Mono>, <Meter key="m" pct={15} accent />, <Mono key="r">99.9%</Mono>, <Mono key="f">0.8% + gas</Mono>],
              ['Other crypto', <Mono key="s">3%</Mono>, <Meter key="m" pct={3} />, <Mono key="r">98.9%</Mono>, <Mono key="f">0.8% + gas</Mono>],
            ]}
          />
        </Panel>

        <Panel title="Tier Routing Contract" label="enforced on every payment" ink>
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
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Routing is policy, not code changes — thresholds live in Treasury money-movement rules
            and apply across every merchant.
          </p>
        </Panel>
      </Grid2>

      <Panel title="Needs Attention" label="items waiting on you">
        <DataTable
          columns={['Item', 'Detail', 'Age', 'Where']}
          rows={[
            [<Pill key="p" tone="warn">dispute</Pill>, 'R12,400 chargeback — SnapPay order #8841', '6h', <Mono key="w">Disputes</Mono>],
            [<Pill key="p" tone="warn">dispute</Pill>, 'R3,150 “item not received” — AfroBiz', '1d', <Mono key="w">Disputes</Mono>],
            [<Pill key="p" tone="accent">routing</Pill>, 'Peach Payments connector degraded — fallback active', '22m', <Mono key="w">Routing</Mono>],
          ]}
        />
      </Panel>
    </>
  );
}

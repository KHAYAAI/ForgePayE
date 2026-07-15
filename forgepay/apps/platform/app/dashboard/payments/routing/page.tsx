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
   FORGE Payments — Routing.
   Connector health, fallback chains, and the tier thresholds that
   decide which rail (Wallet / Payments / Custody) a payment takes.
   ──────────────────────────────────────────────────────────────── */

const CONNECTORS = [
  { name: 'Visa / MC acquiring', kind: 'card', health: 99.6, latency: '820ms', status: 'healthy' },
  { name: 'Peach Payments', kind: 'card', health: 96.1, latency: '2.4s', status: 'degraded' },
  { name: 'Stitch EFT', kind: 'bank', health: 99.8, latency: '1.1s', status: 'healthy' },
  { name: 'Circle USDC', kind: 'stablecoin', health: 99.9, latency: '3.0s', status: 'healthy' },
  { name: 'Keagate (BTC/ETH)', kind: 'crypto', health: 98.9, latency: '9.8s', status: 'healthy' },
];

export default function PaymentsRouting() {
  return (
    <>
      <PageHeader
        eyebrow="FORGE / Payments / Routing"
        title={
          <>
            Routes that <em>heal themselves</em>
          </>
        }
        lede="The router scores every connector continuously. When a rail degrades, traffic shifts down the fallback chain automatically — merchants never see it."
      />

      <StatGrid>
        <Stat label="Active connectors" value="5" delta="1 degraded" deltaTone="down" />
        <Stat label="Fallback events / 24h" value="9" delta="0.3% of volume" />
        <Stat label="Reroutes to Custody" value="3" delta="above $1M tier" />
        <Stat label="Avg route decision" value="14ms" delta="policy engine" deltaTone="up" />
      </StatGrid>

      <Panel title="Connector Health" label="scored continuously · drives routing weight" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Connector', 'Type', 'Success (24h)', '', 'p95 latency', 'Status']}
          rows={CONNECTORS.map((c) => [
            <strong key="n">{c.name}</strong>,
            <Mono key="k">{c.kind}</Mono>,
            <Mono key="h">{c.health}%</Mono>,
            <Meter key="m" pct={c.health} accent={c.health >= 99} />,
            <Mono key="l">{c.latency}</Mono>,
            <Pill key="s" tone={c.status === 'healthy' ? 'ok' : 'warn'}>{c.status}</Pill>,
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Peach Payments is degraded — card traffic is temporarily weighted toward the primary
          acquirer, with ACH as the next hop. Recovery is automatic when its score returns above
          98%.
        </p>
      </Panel>

      <Grid2>
        <Panel title="Fallback Chains" label="ordered per method">
          <DataTable
            columns={['Method', 'Chain', 'Max retries']}
            rows={[
              [<Mono key="m">card</Mono>, 'primary acquirer → Peach → ACH → USDC', <Mono key="r">3</Mono>],
              [<Mono key="m">bank</Mono>, 'Stitch EFT → manual EFT queue', <Mono key="r">1</Mono>],
              [<Mono key="m">usdc</Mono>, 'polygon → ethereum → solana', <Mono key="r">2</Mono>],
              [<Mono key="m">crypto</Mono>, 'native chain only', <Mono key="r">0</Mono>],
            ]}
          />
        </Panel>

        <Panel title="Tier Thresholds" label="who signs, which rail" ink>
          <DataTable
            columns={['Tier', 'Rail', 'Signing']}
            rows={[
              [<Mono key="t">{'< $100K'}</Mono>, 'FORGE Wallet', 'server-side key'],
              [<Mono key="t">$100K – $1M</Mono>, 'FORGE Payments', 'fallback chain'],
              [<Mono key="t">{'> $1M'}</Mono>, 'FORGE Custody', '4-of-7 MPC + approvals'],
            ]}
          />
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            A payment above a wallet's single-transaction ceiling doesn't fail — the wallet refuses
            with <Mono>409 route:forge-custody</Mono> and the router re-submits it to the Custody
            signing queue.
          </p>
        </Panel>
      </Grid2>
    </>
  );
}

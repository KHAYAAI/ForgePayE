'use client';

import {
  PageHeader,
  Panel,
  DataTable,
  Grid2,
  Mono,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Payments — Routing.
   The tier thresholds that decide which rail (Wallet / Payments /
   Custody) a payment takes — policy, not measured traffic.

   Per-connector health scoring (card acquirers, EFT, stablecoin
   rails) isn't wired into this console yet, so it isn't shown here
   rather than shown with invented numbers — check System Health for
   what actually is live-monitored today.
   ──────────────────────────────────────────────────────────────── */

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
              [<Mono key="t">{'> $1M'}</Mono>, 'FORGE Custody', 'signer quorum approval'],
            ]}
          />
        </Panel>
      </Grid2>
    </>
  );
}

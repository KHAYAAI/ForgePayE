'use client';

import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  Pill,
  DataTable,
  Grid2,
  LivePill,
  Mono,
  Addr,
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';

/* ────────────────────────────────────────────────────────────────
   FORGE Custody — Overview.
   Live-wired to forge-custody GET /api/v1/console/summary via the
   /api/forge/custody proxy; demo fixtures render when offline.
   Signing queue lives in Signing, policy + signers in Governance,
   key inventory in Keys, immutable log in Audit.
   ──────────────────────────────────────────────────────────────── */

interface CustodySummary {
  stats: {
    signatures_24h: number;
    notional_24h_usd: number;
    pending_approval: number;
    rejected_7d: number;
    active_keys: number;
    workspaces: number;
  };
  signing_queue: Array<{
    id: string;
    workspace: string;
    destination: string;
    amount_usd: number;
    blockchain: string;
    status: string;
    reason_code: string | null;
    approvals: number;
    approvals_required: number;
    tx_hash: string | null;
    created_at: string;
  }>;
}

const DEMO: CustodySummary = {
  stats: {
    signatures_24h: 12,
    notional_24h_usd: 61_000_000,
    pending_approval: 2,
    rejected_7d: 3,
    active_keys: 9,
    workspaces: 4,
  },
  signing_queue: [
    { id: 'sig_a1b2', workspace: 'Investec Digital Assets', destination: '0xbridge…4f21', amount_usd: 5_000_000, blockchain: 'ethereum', status: 'pending_approval', reason_code: null, approvals: 1, approvals_required: 2, tx_hash: null, created_at: '' },
    { id: 'sig_a1ae', workspace: 'Umuntu Group Treasury', destination: '0xsupplier…9c03', amount_usd: 50_000, blockchain: 'polygon', status: 'pending_approval', reason_code: null, approvals: 0, approvals_required: 1, tx_hash: null, created_at: '' },
  ],
};

const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

export default function CustodyOverview() {
  const { data, live } = useForge<CustodySummary>('custody', DEMO);
  const pending = data.signing_queue.filter((r) => r.status === 'pending_approval');

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody"
        title={
          <>
            Institutional <em>Custody</em>
          </>
        }
        lede="Threshold-signed settlement for transfers above $1M. No single keyholder exists — every signature requires 4 of 7 encrypted shares, and every policy change is itself a governed vote."
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat label="Signatures / 24h" value={data.stats.signatures_24h} delta={`${usd(data.stats.notional_24h_usd)} notional`} />
        <Stat label="Pending approval" value={data.stats.pending_approval} deltaTone={data.stats.pending_approval > 0 ? 'down' : undefined} delta={data.stats.pending_approval > 0 ? 'action required' : 'queue clear'} />
        <Stat label="Policy rejections / 7d" value={data.stats.rejected_7d} delta="see audit log" />
        <Stat label="Active keys" value={data.stats.active_keys} delta="4-of-7 threshold" />
        <Stat label="Workspaces" value={data.stats.workspaces} delta="banks & institutions" />
        <Stat label="Sanctions screens" value="100%" delta="every signing request" deltaTone="up" />
      </StatGrid>

      <Panel title="Waiting on You" label="approvals blocking settlement" ink style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Request', 'Workspace', 'Destination', 'Amount', 'Approvals', 'Status']}
          rows={pending.map((r) => [
            <Mono key="id">{r.id}</Mono>,
            r.workspace,
            <Addr key="d">{r.destination}</Addr>,
            <Mono key="a">{usd(r.amount_usd)}</Mono>,
            <Mono key="ap">{r.approvals} / {r.approvals_required}</Mono>,
            <Pill key="s" tone="warn">{r.status.replace('_', ' ')}</Pill>,
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Approve or reject from the Signing Queue tab — approvals are signed API calls from
          registered approver roles, distinct approvers enforced server-side.
        </p>
      </Panel>

      <Grid2>
        <Panel title="How a Transfer Settles" label="policy → approval → MPC → broadcast">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['1', 'Policy engine', 'destination whitelist, sanctions screen, amount tier — rejections are final and logged'],
              ['2', 'Approvals', 'quorum by amount tier: 2-of-7 under $100K up to 6-of-7 + 2h cooling-off above $1M'],
              ['3', 'MPC signing', '4-of-7 encrypted shares collected; no plaintext key ever exists'],
              ['4', 'Broadcast', '12-block confirmation, then one event to the Revenue Ontology'],
            ].map(([n, step, desc]) => (
              <li key={step} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 18 }}>{n}</span>
                <span style={{ fontWeight: 500, minWidth: 120 }}>{step}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Governance at a Glance" label="full matrix in Governance">
          <DataTable
            columns={['Action', 'Required', 'Cooling-off']}
            rows={[
              ['Transfer > $1M', <Mono key="r">6 of 7</Mono>, '2 hours'],
              ['Create / change company wallet', <Mono key="r">2 of 3 seniors</Mono>, 'none'],
              ['Add or remove a signer', <Mono key="r">4 of 7</Mono>, '24 hours'],
              ['Change the policy table', <Mono key="r">4 of 7</Mono>, '24 hours'],
            ]}
          />
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Wallet provisioning, signer changes and policy edits queue exactly like transfers —
            nothing takes effect on a single keyholder's say-so.
          </p>
        </Panel>
      </Grid2>
    </>
  );
}

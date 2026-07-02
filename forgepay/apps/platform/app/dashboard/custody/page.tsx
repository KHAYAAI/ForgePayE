'use client';

import { useState } from 'react';
import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  Pill,
  DataTable,
  Grid2,
  Mono,
  Addr,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Custody — institutional custody & threshold signing.
   (OpenFireblocks, integrated into the FORGE ecosystem.)
   Signing queue → policy checks → multi-party approval →
   4-of-7 MPC signature → broadcast → ontology event.
   ──────────────────────────────────────────────────────────────── */

type SigningRequest = {
  id: string;
  workspace: string;
  destination: string;
  amount: string;
  chain: string;
  status: 'pending_approval' | 'approved' | 'signing' | 'broadcast' | 'confirmed' | 'rejected';
  approvals: string;
  policy: string;
};

const INITIAL_QUEUE: SigningRequest[] = [
  {
    id: 'sig_a1b2',
    workspace: 'Investec Digital Assets',
    destination: '0xbridge…4f21',
    amount: '$5.0M USDC',
    chain: 'ethereum',
    status: 'pending_approval',
    approvals: '1 / 2 (CFO ✓, CEO —)',
    policy: 'PASS · whitelist ✓ · daily limit ✓',
  },
  {
    id: 'sig_a1ae',
    workspace: 'Umuntu Group Treasury',
    destination: '0xsupplier…9c03',
    amount: '$50K USDC',
    chain: 'polygon',
    status: 'pending_approval',
    approvals: '0 / 1 (Treasury —)',
    policy: 'PASS · agent credit line_agent_001',
  },
  {
    id: 'sig_a19f',
    workspace: 'Investec Digital Assets',
    destination: '0xcustody…77aa',
    amount: '$12.4M USDC',
    chain: 'ethereum',
    status: 'signing',
    approvals: '2 / 2 complete',
    policy: 'PASS',
  },
  {
    id: 'sig_a18c',
    workspace: 'AfroBiz Lending',
    destination: '0xsettle…10de',
    amount: '$1.8M USDC',
    chain: 'polygon',
    status: 'confirmed',
    approvals: '2 / 2 complete',
    policy: 'PASS',
  },
  {
    id: 'sig_a17b',
    workspace: 'Umuntu Group Treasury',
    destination: '0xunknown…e4d9',
    amount: '$3.2M USDC',
    chain: 'ethereum',
    status: 'rejected',
    approvals: '—',
    policy: 'FAIL · destination not whitelisted',
  },
];

const STATUS_TONE: Record<SigningRequest['status'], 'ok' | 'warn' | 'danger' | 'accent' | 'ink'> = {
  pending_approval: 'warn',
  approved: 'accent',
  signing: 'accent',
  broadcast: 'accent',
  confirmed: 'ok',
  rejected: 'danger',
};

export default function CustodyConsole() {
  const [queue, setQueue] = useState(INITIAL_QUEUE);

  const approve = (id: string) =>
    setQueue((q) =>
      q.map((r) =>
        r.id === id
          ? { ...r, status: 'signing', approvals: 'complete — collecting 4-of-7 shares' }
          : r
      )
    );

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody"
        title={
          <>
            Institutional <em>Custody</em>
          </>
        }
        lede="Threshold-signed settlement for transfers above $1M. No single keyholder exists — every signature requires 4 of 7 encrypted shares."
        actions={<button className="btn-ink btn-sm">New Signing Request</button>}
      />

      <StatGrid>
        <Stat label="Signatures / 24h" value="12" delta="$61M notional" />
        <Stat label="Pending approval" value="2" delta="oldest 41 min" deltaTone="down" />
        <Stat label="Policy rejections / 7d" value="3" delta="all whitelist misses" />
        <Stat label="Avg confirm time" value="187s" delta="12 block confirmations" />
        <Stat label="Active keys" value="9" delta="4-of-7 threshold" />
        <Stat label="Sanctions screens" value="100%" delta="Chainalysis · 0 hits" deltaTone="up" />
      </StatGrid>

      <Panel title="Signing Queue" label="policy → approval → 4-of-7 MPC → broadcast" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Request', 'Workspace', 'Destination', 'Amount', 'Chain', 'Policy', 'Approvals', 'Status', '']}
          rows={queue.map((r) => [
            <Mono key="id">{r.id}</Mono>,
            r.workspace,
            <Addr key="d">{r.destination}</Addr>,
            <Mono key="a">{r.amount}</Mono>,
            <Mono key="c">{r.chain}</Mono>,
            <span key="p" style={{ fontSize: 12.5, color: r.policy.startsWith('FAIL') ? 'var(--danger)' : 'var(--steel)' }}>
              {r.policy}
            </span>,
            <span key="ap" style={{ fontSize: 12.5 }}>{r.approvals}</span>,
            <Pill key="s" tone={STATUS_TONE[r.status]}>{r.status.replace('_', ' ')}</Pill>,
            r.status === 'pending_approval' ? (
              <button key="b" className="btn-ghost btn-sm" onClick={() => approve(r.id)}>
                Approve
              </button>
            ) : (
              <span key="b" />
            ),
          ])}
        />
      </Panel>

      <Grid2>
        <Panel title="Policy Engine" label="evaluated before signing — OPA">
          <DataTable
            columns={['Policy', 'Rule', 'Scope', 'Status']}
            rows={[
              ['Daily limit', <Mono key="1">$100M / 24h · used $61M</Mono>, 'Investec Digital Assets', <Pill key="p" tone="ok">enforced</Pill>],
              ['Destination whitelist', <Mono key="2">142 addresses</Mono>, 'all workspaces', <Pill key="p" tone="ok">enforced</Pill>],
              ['Approval threshold', <Mono key="3">&gt; $10M → CFO + CEO</Mono>, 'Investec Digital Assets', <Pill key="p" tone="ok">enforced</Pill>],
              ['Time window', <Mono key="4">Mon–Fri 09:00–17:00 UTC</Mono>, 'Umuntu Group Treasury', <Pill key="p" tone="ok">enforced</Pill>],
              ['Chain restriction', <Mono key="5">ethereum, polygon only</Mono>, 'all workspaces', <Pill key="p" tone="ok">enforced</Pill>],
              ['Sanctions screen', <Mono key="6">OFAC via Chainalysis</Mono>, 'all workspaces', <Pill key="p" tone="ok">enforced</Pill>],
            ]}
          />
        </Panel>

        <Panel title="Key Inventory" label="shares in Vault — metadata only" ink>
          <DataTable
            columns={['Key', 'Chain', 'Threshold', 'Rotation', 'Ceremony']}
            rows={[
              [<Mono key="1">key_settlement_eth</Mono>, 'ethereum', <Mono key="t">4 of 7</Mono>, <Pill key="r" tone="ok">current</Pill>, <Mono key="c">dkg_2026_03</Mono>],
              [<Mono key="2">key_settlement_polygon</Mono>, 'polygon', <Mono key="t">4 of 7</Mono>, <Pill key="r" tone="ok">current</Pill>, <Mono key="c">dkg_2026_03</Mono>],
              [<Mono key="3">key_treasury_ops</Mono>, 'ethereum', <Mono key="t">3 of 5</Mono>, <Pill key="r" tone="warn">rotate Q3</Pill>, <Mono key="c">dkg_2025_11</Mono>],
            ]}
          />
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Private keys never exist in plaintext. Feldman-VSS share commitments verified at each
            DKG ceremony; encrypted shares live in HashiCorp Vault behind AWS KMS.
          </p>
        </Panel>
      </Grid2>

      <Panel title="Immutable Audit Log" label="every access · append-only">
        <DataTable
          columns={['Time (UTC)', 'Actor', 'Action', 'Object', 'Result']}
          rows={[
            [<Mono key="t">14:47:12</Mono>, 'system', 'signature.confirmed', <Mono key="o">sig_a18c · 0x7f3a…</Mono>, <Pill key="r" tone="ok">ok</Pill>],
            [<Mono key="t">14:31:04</Mono>, 'cfo@investec', 'signing.approve', <Mono key="o">sig_a1b2</Mono>, <Pill key="r" tone="ok">ok</Pill>],
            [<Mono key="t">14:29:55</Mono>, 'policy-engine', 'policy.reject', <Mono key="o">sig_a17b · whitelist</Mono>, <Pill key="r" tone="danger">rejected</Pill>],
            [<Mono key="t">14:12:38</Mono>, 'mpc-orchestrator', 'shares.collected', <Mono key="o">sig_a19f · 4/7</Mono>, <Pill key="r" tone="ok">ok</Pill>],
            [<Mono key="t">13:58:20</Mono>, 'treasury@umuntu', 'signing.create', <Mono key="o">sig_a1ae</Mono>, <Pill key="r" tone="ok">ok</Pill>],
          ]}
        />
      </Panel>
    </>
  );
}

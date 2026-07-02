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
   FORGE Custody — institutional custody & threshold signing.
   (OpenFireblocks, integrated into the FORGE ecosystem.)
   Live-wired to forge-custody GET /api/v1/console/summary via the
   /api/forge/custody proxy; demo fixtures render when offline.
   ──────────────────────────────────────────────────────────────── */

type SigningRow = {
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
};

interface CustodySummary {
  stats: {
    signatures_24h: number;
    notional_24h_usd: number;
    pending_approval: number;
    rejected_7d: number;
    active_keys: number;
    workspaces: number;
  };
  signing_queue: SigningRow[];
  keys: Array<{ id: string; blockchain: string; threshold: string; rotation_status: string }>;
  recent_audit: Array<{ at: string; actor: string; action: string; resource: string | null; status: number | null }>;
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
    { id: 'sig_a19f', workspace: 'Investec Digital Assets', destination: '0xcustody…77aa', amount_usd: 12_400_000, blockchain: 'ethereum', status: 'signing', reason_code: null, approvals: 2, approvals_required: 2, tx_hash: null, created_at: '' },
    { id: 'sig_a18c', workspace: 'AfroBiz Lending', destination: '0xsettle…10de', amount_usd: 1_800_000, blockchain: 'polygon', status: 'confirmed', reason_code: null, approvals: 2, approvals_required: 2, tx_hash: '0x7f3a…', created_at: '' },
    { id: 'sig_a17b', workspace: 'Umuntu Group Treasury', destination: '0xunknown…e4d9', amount_usd: 3_200_000, blockchain: 'ethereum', status: 'rejected', reason_code: 'DESTINATION_NOT_WHITELISTED', approvals: 0, approvals_required: 0, tx_hash: null, created_at: '' },
  ],
  keys: [
    { id: 'key_settlement_eth', blockchain: 'ethereum', threshold: '4-of-7', rotation_status: 'active' },
    { id: 'key_settlement_polygon', blockchain: 'polygon', threshold: '4-of-7', rotation_status: 'active' },
    { id: 'key_treasury_ops', blockchain: 'ethereum', threshold: '3-of-5', rotation_status: 'rotating' },
  ],
  recent_audit: [
    { at: '14:47:12', actor: 'system', action: 'signature.confirmed', resource: 'sig_a18c', status: 200 },
    { at: '14:31:04', actor: 'cfo@investec', action: 'signing.approve', resource: 'sig_a1b2', status: 200 },
    { at: '14:29:55', actor: 'policy-engine', action: 'policy.reject', resource: 'sig_a17b', status: 200 },
    { at: '14:12:38', actor: 'mpc-orchestrator', action: 'shares.collected', resource: 'sig_a19f', status: 200 },
    { at: '13:58:20', actor: 'treasury@umuntu', action: 'signing.create', resource: 'sig_a1ae', status: 201 },
  ],
};

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  pending_policy: 'warn',
  pending_approval: 'warn',
  approved: 'accent',
  signing: 'accent',
  broadcast: 'accent',
  confirmed: 'ok',
  rejected: 'danger',
  failed: 'danger',
};

const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

export default function CustodyConsole() {
  const { data, live } = useForge<CustodySummary>('custody', DEMO);

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

      <Panel title="Signing Queue" label="policy → approval → 4-of-7 MPC → broadcast" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Request', 'Workspace', 'Destination', 'Amount', 'Chain', 'Approvals', 'Status', 'Tx']}
          rows={data.signing_queue.map((r) => [
            <Mono key="id">{r.id}</Mono>,
            r.workspace,
            <Addr key="d">{r.destination}</Addr>,
            <Mono key="a">{usd(r.amount_usd)}</Mono>,
            <Mono key="c">{r.blockchain}</Mono>,
            <Mono key="ap">{r.approvals_required > 0 ? `${r.approvals} / ${r.approvals_required}` : '—'}</Mono>,
            <span key="s" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <Pill tone={STATUS_TONE[r.status]}>{r.status.replace('_', ' ')}</Pill>
              {r.reason_code && (
                <span style={{ fontSize: 11.5, color: 'var(--danger)' }}>{r.reason_code}</span>
              )}
            </span>,
            <Addr key="t">{r.tx_hash ?? '—'}</Addr>,
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Approvals are signed API calls (`POST /api/v1/signing/:id/approve`) from registered
          approver roles — distinct approvers and distinct roles enforced server-side.
        </p>
      </Panel>

      <Grid2>
        <Panel title="Key Inventory" label="shares in Vault — metadata only" ink>
          <DataTable
            columns={['Key', 'Chain', 'Threshold', 'Rotation']}
            rows={data.keys.map((k) => [
              <Mono key="1">{k.id}</Mono>,
              k.blockchain,
              <Mono key="t">{k.threshold}</Mono>,
              <Pill key="r" tone={k.rotation_status === 'active' ? 'ok' : 'warn'}>{k.rotation_status}</Pill>,
            ])}
          />
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Private keys never exist in plaintext. Feldman-VSS share commitments verified at each
            DKG ceremony; encrypted shares live in HashiCorp Vault behind AWS KMS.
          </p>
        </Panel>

        <Panel title="Immutable Audit Log" label="every access · append-only">
          <DataTable
            columns={['Time', 'Actor', 'Action', 'Object', 'Status']}
            rows={data.recent_audit.map((e, i) => [
              <Mono key={`t${i}`}>{e.at.includes('T') ? e.at.slice(11, 19) : e.at}</Mono>,
              e.actor,
              <Mono key={`a${i}`}>{e.action}</Mono>,
              <Mono key={`o${i}`}>{e.resource ?? '—'}</Mono>,
              <Pill key={`s${i}`} tone={e.action.includes('reject') ? 'danger' : 'ok'}>
                {e.action.includes('reject') ? 'rejected' : 'ok'}
              </Pill>,
            ])}
          />
        </Panel>
      </Grid2>
    </>
  );
}

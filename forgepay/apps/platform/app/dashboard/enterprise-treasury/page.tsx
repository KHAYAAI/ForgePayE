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
  LivePill,
  Mono,
  Addr,
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';

/* ────────────────────────────────────────────────────────────────
   Enterprise Treasury — consolidation, netting, sweeps, and the
   approval desk for agent credit extensions. Live-wired to
   enterprise-treasury /v1/cash-position + /v1/rules via the
   /api/forge/treasury proxy; demo fixtures when offline.
   ──────────────────────────────────────────────────────────────── */

interface TreasurySummary {
  cash_position: {
    data?: {
      totalUsd: number;
      idleCashUsd: number;
      deployedInYieldUsd: number;
      opportunityCostUsdPerYear: number;
      bySubsidiary: Record<string, { name: string; totalUsd: number; accountCount: number; currencies: string[]; runwayDays: number }>;
      lastConsolidated: string;
    };
  } | null;
  rules: { data?: Array<{ id: string; name: string; enabled: boolean }> } | null;
  approvals: { data?: Array<Record<string, unknown>> } | null;
  netting_flows: { data?: Array<Record<string, unknown>> } | null;
}

const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

export default function EnterpriseTreasury() {
  const { data: liveData, live } = useForge<TreasurySummary>('treasury', {
    cash_position: null,
    rules: null,
    approvals: null,
    netting_flows: null,
  });
  const position = liveData.cash_position?.data;
  const liveRules = liveData.rules?.data ?? [];
  const nettingFlows = (liveData.netting_flows?.data ?? []) as Array<Record<string, unknown>>;
  const rawApprovals = (liveData.approvals?.data ?? []) as Array<Record<string, unknown>>;

  interface ApprovalRow { id: string; kind: string; detail: string; requestedBy: string; status: 'pending' | 'approved' }
  const [overrides, setOverrides] = useState<Record<string, 'approved'>>({});
  const approvals: ApprovalRow[] = rawApprovals.map((a) => ({
    id: String(a['id'] ?? ''),
    kind: String(a['kind'] ?? a['type'] ?? 'Approval'),
    detail: String(a['detail'] ?? ''),
    requestedBy: String(a['requestedBy'] ?? a['requested_by'] ?? ''),
    status: overrides[String(a['id'] ?? '')] ?? (a['status'] === 'approved' ? 'approved' : 'pending'),
  }));

  const approve = (id: string) => setOverrides((o) => ({ ...o, [id]: 'approved' }));

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Enterprise Treasury"
        title={
          <>
            One <em>cash position</em>, every account
          </>
        }
        lede="Real-time consolidation across subsidiaries, intercompany netting, rule-driven sweeps — and the approval desk that extends credit to agents against custody funds."
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat
          label="Consolidated cash"
          value={position ? usd(position.totalUsd) : '—'}
          delta={
            position
              ? `${Object.values(position.bySubsidiary).reduce((s, x) => s + x.accountCount, 0)} accounts · ${Object.keys(position.bySubsidiary).length} subsidiaries`
              : 'treasury unreachable'
          }
        />
        <Stat
          label="Idle cash"
          value={position ? usd(position.idleCashUsd) : '—'}
          delta={position ? `${usd(position.opportunityCostUsdPerYear)}/yr opportunity cost` : 'no data yet'}
          deltaTone="down"
        />
        <Stat
          label="Deployed in yield"
          value={position ? usd(position.deployedInYieldUsd) : '—'}
          delta="via yield-engine"
          deltaTone="up"
        />
        <Stat label="Active rules" value={liveRules.filter((r) => r.enabled).length} delta="evaluated every 60s" />
        <Stat label="Pending approvals" value={approvals.filter((a) => a.status === 'pending').length} delta="approval desk" />
        <Stat label="Netting flows today" value={nettingFlows.length} delta="intercompany" />
      </StatGrid>

      {position && (
        <Panel title="Subsidiary Positions" label={`consolidated ${position.lastConsolidated.slice(0, 16).replace('T', ' ')} UTC`} style={{ marginBottom: 20 }}>
          <DataTable
            columns={['Subsidiary', 'Total', 'Accounts', 'Currencies', 'Runway']}
            rows={Object.values(position.bySubsidiary).map((s) => [
              s.name,
              <Mono key="t">{usd(s.totalUsd)}</Mono>,
              <Mono key="a">{s.accountCount}</Mono>,
              s.currencies.join(' · '),
              <Mono key="r">{s.runwayDays}d</Mono>,
            ])}
          />
        </Panel>
      )}

      <Panel title="Approval Desk" label="one-click CFO decisions" ink style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Request', 'Type', 'Detail', 'Requested by', 'Status', '']}
          emptyMessage="No approvals pending."
          rows={approvals.map((a) => [
            <Mono key="id">{a.id}</Mono>,
            a.kind,
            <span key="d" style={{ fontSize: 13 }}>{a.detail}</span>,
            <span key="r" className="mono">{a.requestedBy}</span>,
            <Pill key="s" tone={a.status === 'approved' ? 'ok' : 'warn'}>{a.status}</Pill>,
            a.status === 'pending' ? (
              <button key="b" className="btn-ghost btn-sm" onClick={() => approve(a.id)} style={{ borderColor: 'var(--paper)', color: 'var(--paper)' }}>
                Approve
              </button>
            ) : (
              <span key="b" />
            ),
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Approving an agent credit extension updates the line in the Agent Credit Bureau and
          authorizes FORGE Custody to settle draws from the enterprise custody account. Repayment
          auto-sweeps principal + fee back on term.
        </p>
      </Panel>

      <Grid2>
        <Panel title="Subsidiary Accounts" label="refreshed 15 min · bank-connectivity">
          {position ? (
            <DataTable
              columns={['Subsidiary', 'Total', 'Accounts', 'Currencies', 'Runway']}
              emptyMessage="No subsidiary accounts connected yet."
              rows={Object.values(position.bySubsidiary).map((s) => [
                s.name,
                <Mono key="t">{usd(s.totalUsd)}</Mono>,
                <Mono key="a">{s.accountCount}</Mono>,
                s.currencies.join(' · '),
                <Mono key="r">{s.runwayDays}d</Mono>,
              ])}
            />
          ) : (
            <p className="lede" style={{ fontSize: 13 }}>No bank accounts connected yet — link one via bank-connectivity.</p>
          )}
        </Panel>

        <Panel title="Intercompany Netting" label="today's cycle">
          <DataTable
            columns={['Flow', 'Gross', 'Netted', 'Wires']}
            emptyMessage="No netting flows today."
            rows={nettingFlows.map((f, i) => [
              String(f['flow'] ?? f['pair'] ?? '—'),
              <Mono key={`g${i}`}>{String(f['gross'] ?? '—')}</Mono>,
              <Mono key={`n${i}`}>{String(f['netted'] ?? '—')}</Mono>,
              <Mono key={`w${i}`}>{String(f['wires'] ?? '—')}</Mono>,
            ])}
          />
        </Panel>
      </Grid2>

      <Grid2>
        <Panel title="Rules Engine" label="evaluated every 60s">
          <DataTable
            columns={['Rule', 'Name', 'Status']}
            emptyMessage="No sweep rules configured yet."
            rows={liveRules.map((r) => [
              <Mono key="r">{r.id}</Mono>,
              r.name,
              <Pill key="s" tone={r.enabled ? 'ok' : undefined}>{r.enabled ? 'armed' : 'disabled'}</Pill>,
            ])}
          />
        </Panel>

        <Panel title="Agent Credit Flow" label="closed loop with bureau + custody">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['01', 'Bureau requests extension for a scored agent.'],
              ['02', 'Treasury manager approves — line updated, custody authorized.'],
              ['03', 'FORGE Custody threshold-signs the draw from the enterprise account.'],
              ['04', 'Ontology records the draw; bureau tracks the receivable.'],
              ['05', 'On term, rule R-021 auto-sweeps principal + fee back.'],
              ['06', 'Bureau lifts the agent score; the line grows for next time.'],
            ].map(([n, desc]) => (
              <li key={n} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 24 }}>{n}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </Grid2>
    </>
  );
}

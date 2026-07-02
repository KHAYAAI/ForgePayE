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
  const liveRules = liveData.rules?.data;
  const [approvals, setApprovals] = useState([
    {
      id: 'apr_7311',
      kind: 'Agent credit extension',
      detail: 'did:forge:agent_001 · R25K → R100K (score 82, 52/52 on-time)',
      requestedBy: 'Agent Credit Bureau',
      status: 'pending' as 'pending' | 'approved',
    },
    {
      id: 'apr_7309',
      kind: 'Sweep rule change',
      detail: 'R-014: raise yield-sweep threshold R500K → R1M',
      requestedBy: 'treasury@umuntu',
      status: 'pending' as 'pending' | 'approved',
    },
  ]);

  const approve = (id: string) =>
    setApprovals((xs) => xs.map((x) => (x.id === id ? { ...x, status: 'approved' } : x)));

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
          value={position ? usd(position.totalUsd) : 'R48.6M'}
          delta={
            position
              ? `${Object.values(position.bySubsidiary).reduce((s, x) => s + x.accountCount, 0)} accounts · ${Object.keys(position.bySubsidiary).length} subsidiaries`
              : '14 accounts · 3 subsidiaries'
          }
        />
        <Stat
          label="Idle cash"
          value={position ? usd(position.idleCashUsd) : 'R4.1M'}
          delta={position ? `${usd(position.opportunityCostUsdPerYear)}/yr opportunity cost` : 'earning 0%'}
          deltaTone="down"
        />
        <Stat
          label="Deployed in yield"
          value={position ? usd(position.deployedInYieldUsd) : 'R38.2M'}
          delta="via yield-engine"
          deltaTone="up"
        />
        <Stat label="Active rules" value={liveRules ? liveRules.filter((r) => r.enabled).length : 4} delta="evaluated every 60s" />
        <Stat label="Agent lines funded" value="R2.1M" delta="via custody account" />
        <Stat label="Netting saved / mo" value="R114K" delta="wire fees avoided" deltaTone="up" />
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
        <Panel title="Account Positions" label="refreshed 15 min · bank-connectivity">
          <DataTable
            columns={['Account', 'Subsidiary', 'Currency', 'Balance', 'Status']}
            rows={[
              [<Mono key="a">FNB ****2201</Mono>, 'Umuntu Holdings', 'ZAR', <Mono key="b">R21.4M</Mono>, <Pill key="s" tone="ok">reconciled</Pill>],
              [<Mono key="a">Standard ****8817</Mono>, 'Umuntu Trading', 'ZAR', <Mono key="b">R9.8M</Mono>, <Pill key="s" tone="ok">reconciled</Pill>],
              [<Mono key="a">Absa ****4410</Mono>, 'Umuntu Logistics', 'ZAR', <Mono key="b">R6.2M</Mono>, <Pill key="s" tone="ok">reconciled</Pill>],
              [<Mono key="a">Circle USDC vault</Mono>, 'Group Treasury', 'USDC', <Mono key="b">$612K</Mono>, <Pill key="s" tone="ok">on-chain</Pill>],
              [<Mono key="a">Custody 0xenterprise…</Mono>, 'Group Treasury', 'USDC', <Mono key="b">$180K</Mono>, <Pill key="s" tone="accent">4-of-7 custody</Pill>],
            ]}
          />
        </Panel>

        <Panel title="Intercompany Netting" label="today's cycle">
          <DataTable
            columns={['Flow', 'Gross', 'Netted', 'Wires']}
            rows={[
              ['Holdings ↔ Trading', <Mono key="g">R3.1M</Mono>, <Mono key="n">R840K</Mono>, <Mono key="w">4 → 1</Mono>],
              ['Trading ↔ Logistics', <Mono key="g">R1.7M</Mono>, <Mono key="n">R420K</Mono>, <Mono key="w">3 → 1</Mono>],
              ['Logistics ↔ Holdings', <Mono key="g">R950K</Mono>, <Mono key="n">R0 (cleared)</Mono>, <Mono key="w">2 → 0</Mono>],
            ]}
          />
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Net settlement collapses 9 wires into 2 — R114K/month in avoided fees at current volume.
          </p>
        </Panel>
      </Grid2>

      <Grid2>
        <Panel title="Rules Engine" label="evaluated every 60s">
          <DataTable
            columns={['Rule', 'Trigger', 'Action', 'Last Run', 'Status']}
            rows={[
              [<Mono key="r">R-014</Mono>, 'Operating balance > R1M', 'Sweep excess → yield account', <Mono key="t">14:32</Mono>, <Pill key="s" tone="ok">armed</Pill>],
              [<Mono key="r">R-021</Mono>, 'Agent repayment date', 'Auto-sweep principal + 1% fee', <Mono key="t">09:00</Mono>, <Pill key="s" tone="ok">armed</Pill>],
              [<Mono key="r">R-030</Mono>, 'USDC balance < $100K', 'Alert CFO + pause agent draws', <Mono key="t">—</Mono>, <Pill key="s" tone="ok">armed</Pill>],
              [<Mono key="r">R-007</Mono>, 'FX hedge ratio < 75%', 'Queue forward contract approval', <Mono key="t">11:15</Mono>, <Pill key="s" tone="warn">fired 11:15</Pill>],
            ]}
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

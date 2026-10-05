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
   Enterprise Treasury — consolidation, intercompany netting, rules
   and the approval desk. Live-wired to enterprise-treasury
   (/v1/cash-position, /v1/rules, /v1/rules/approvals,
   /v1/netting/flows) through /api/forge/treasury. Field names below
   match those responses (NettingFlow, PendingApproval in
   services/enterprise-treasury); they used to read fields the service
   never sends, so every row rendered as dashes.
   Treasury cannot sweep to or from yield (it is not connected to the
   yield engine), so nothing here offers that.
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
    /** When the bank balances were last read, and why the last refresh failed (if it did). */
    balancesAsOf?: string | null;
    refreshError?: string | null;
  } | null;
  rules: { data?: Array<{ id: string; name: string; enabled: boolean; action?: { type: string } }> } | null;
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

  interface ApprovalRow { id: string; kind: string; detail: string; requestedBy: string; status: 'pending' | 'approved' | 'rejected' }
  const [overrides, setOverrides] = useState<Record<string, 'approved'>>({});
  const approvals: ApprovalRow[] = rawApprovals.map((a) => ({
    id: String(a['id'] ?? ''),
    kind: String(a['ruleName'] ?? 'Rule'),
    detail: String(a['reason'] ?? ''),
    requestedBy: a['ruleId'] ? `rule ${String(a['ruleId'])}` : '—',
    status: overrides[String(a['id'] ?? '')]
      ?? (a['approved'] === true ? 'approved' : a['approved'] === false ? 'rejected' : 'pending'),
  }));

  const [approvalError, setApprovalError] = useState<string | null>(null);
  // Resolved in enterprise-treasury; the row only shows approved once the
  // service has recorded it. (This used to change local state only.)
  const approve = async (id: string) => {
    setApprovalError(null);
    const res = await fetch(`/api/forge/treasury-approvals/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    }).catch(() => null);
    const json = res ? ((await res.json().catch(() => null)) as { live?: boolean; error?: string } | null) : null;
    if (res?.ok && json?.live) setOverrides((o) => ({ ...o, [id]: 'approved' }));
    else setApprovalError(`Could not approve: ${json?.error ?? 'treasury unreachable'}`);
  };

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Enterprise Treasury"
        title={
          <>
            One <em>cash position</em>, every account
          </>
        }
        lede="Consolidated cash across linked bank accounts, intercompany netting, and an approval desk for rules that need a person's sign-off. Settlement instructions are recorded for an operator to execute; nothing moves on its own."
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat
          label="Consolidated cash"
          value={position ? usd(position.totalUsd) : '—'}
          delta={
            liveData.cash_position?.refreshError
              ? `balances not refreshed: ${liveData.cash_position.refreshError}`
              : position
                ? `${Object.values(position.bySubsidiary).reduce((s, x) => s + x.accountCount, 0)} accounts · as of ${liveData.cash_position?.balancesAsOf ? new Date(liveData.cash_position.balancesAsOf).toLocaleString() : 'never'}`
                : 'treasury unreachable'
          }
        />
        <Stat
          label="Idle cash"
          value={position ? usd(position.idleCashUsd) : '—'}
          delta={position ? `${usd(position.opportunityCostUsdPerYear)}/yr opportunity cost` : 'no data yet'}
          deltaTone="down"
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
        {approvalError && <p role="alert" style={{ color: 'var(--paper)', marginBottom: 12 }}>{approvalError}</p>}
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
            columns={['From', 'To', 'Amount', 'Invoice', 'Due']}
            emptyMessage="No pending intercompany flows."
            rows={nettingFlows.map((f, i) => [
              String(f['fromSubsidiary'] ?? '—'),
              String(f['toSubsidiary'] ?? '—'),
              <Mono key={`a${i}`}>{typeof f['amount'] === 'number' ? `${usd(f['amount'] as number)} ${String(f['currency'] ?? '')}` : '—'}</Mono>,
              <Mono key={`r${i}`}>{String(f['invoiceRef'] ?? '—')}</Mono>,
              String(f['dueDate'] ?? '—'),
            ])}
          />
        </Panel>
      </Grid2>

      <Grid2>
        <Panel title="Rules Engine" label="evaluated every 60s">
          <DataTable
            columns={['Rule', 'Name', 'Status']}
            emptyMessage="No rules configured. Treasury starts with none: nothing moves unless someone sets it up."
            rows={liveRules.map((r) => [
              <Mono key="r">{r.id}</Mono>,
              r.name,
              r.action && (r.action.type === 'sweep_to_yield' || r.action.type === 'repatriate_from_yield')
                ? <Pill key="s" tone="warn">not available</Pill>
                : <Pill key="s" tone={r.enabled ? 'ok' : undefined}>{r.enabled ? 'armed' : 'disabled'}</Pill>,
            ])}
          />
        </Panel>

        <Panel title="What treasury does not do yet" label="so nothing here is mistaken for it">
          <ul style={{ listStyle: 'none' }}>
            {[
              'Move money: settlement instructions are recorded for an operator to execute at the bank.',
              'Sweep idle cash into yield, or bring it back: not connected to the yield engine.',
              'Extend credit to agents: credit lines are bookkeeping only.',
            ].map((t) => (
              <li key={t} style={{ padding: '11px 0', borderBottom: '1px solid var(--hair)', color: 'var(--steel)', fontSize: 13.5 }}>{t}</li>
            ))}
          </ul>
        </Panel>
      </Grid2>
    </>
  );
}

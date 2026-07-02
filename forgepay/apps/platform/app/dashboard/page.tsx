'use client';

import Link from 'next/link';
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

interface OverviewLive {
  custody: { live: boolean; data: { stats?: { signatures_24h?: number; pending_approval?: number } } | null };
  wallet: { live: boolean; data: { stats?: { total_wallets?: number; transactions_24h?: number } } | null };
  treasury: { live: boolean; data: Record<string, unknown> | null };
  bureau: { live: boolean; data: { stats?: { totalAgents?: number } } | null };
  ontology: { live: boolean; data: unknown };
}

/* ────────────────────────────────────────────────────────────────
   FORGE — Unified Ontology Overview
   One screen across every interconnected platform:
   Payments → Wallet (<$100K) → Custody (>$1M) with the Revenue
   Ontology as the single source of truth, consumed by the Agent
   Credit Bureau and Enterprise Treasury.
   ──────────────────────────────────────────────────────────────── */

const PLATFORMS = [
  {
    href: '/dashboard/payments',
    name: 'FORGE Payments',
    role: 'Routing & settlement',
    metric: 'R4.2M processed / 24h',
    status: 'ok' as const,
    statusLabel: '99.7% success',
  },
  {
    href: '/dashboard/custody',
    name: 'FORGE Custody',
    role: 'Institutional 4-of-7 threshold signing',
    metric: '12 signatures / 24h · $61M notional',
    status: 'ok' as const,
    statusLabel: '3 pending approval',
  },
  {
    href: '/dashboard/wallet',
    name: 'FORGE Wallet',
    role: 'Consumer & agent wallets, did:forge identity',
    metric: '18,420 wallets · 1,204 tx / 24h',
    status: 'ok' as const,
    statusLabel: '2 recoveries open',
  },
  {
    href: '/dashboard/agent-credit-bureau',
    name: 'Agent Credit Bureau',
    role: 'Reputation & credit for autonomous agents',
    metric: '312 agents scored · R2.1M lines drawn',
    status: 'warn' as const,
    statusLabel: '1 extension pending',
  },
  {
    href: '/dashboard/enterprise-treasury',
    name: 'Enterprise Treasury',
    role: 'Consolidation, netting, credit approvals',
    metric: 'R48.6M consolidated · 14 accounts',
    status: 'ok' as const,
    statusLabel: '2 sweeps queued',
  },
  {
    href: '/dashboard/credit-bureau',
    name: 'Credit Bureau',
    role: 'Dual-mode merchant scoring (Mode 1 / Mode 2)',
    metric: '487 inquiries / 24h',
    status: 'ok' as const,
    statusLabel: '12 variance alerts',
  },
];

const ONTOLOGY_EVENTS: Array<{
  id: string;
  type: string;
  actor: string;
  detail: string;
  amount: string;
  route: string;
  tone?: 'ok' | 'warn' | 'accent';
}> = [
  {
    id: 'evt_9f31',
    type: 'custody.signature.confirmed',
    actor: 'enterprise_custody',
    detail: 'Agent supplier payment · net-30 credit line',
    amount: '$50,000 USDC',
    route: 'CUSTODY 4-OF-7',
    tone: 'accent',
  },
  {
    id: 'evt_9f30',
    type: 'credit.score.updated',
    actor: 'did:forge:agent_001',
    detail: 'On-time repayment observed → score 78 → 82',
    amount: 'line R150K → R250K',
    route: 'AGENT BUREAU',
    tone: 'ok',
  },
  {
    id: 'evt_9f2e',
    type: 'wallet.transaction.confirmed',
    actor: 'did:forge:user_8842',
    detail: 'Checkout — merchant SnapPay',
    amount: '$50 USDC',
    route: 'WALLET DIRECT',
  },
  {
    id: 'evt_9f2b',
    type: 'treasury.sweep.executed',
    actor: 'treasury:umuntu-group',
    detail: 'Auto-sweep to yield account (rule R-014)',
    amount: 'R1.2M',
    route: 'ENTERPRISE TREASURY',
  },
  {
    id: 'evt_9f29',
    type: 'payment.settled',
    actor: 'merch_snappay',
    detail: 'Stripe ACH primary · no fallback used',
    amount: 'R84,300',
    route: 'PAYMENTS',
  },
  {
    id: 'evt_9f27',
    type: 'compliance.screen.cleared',
    actor: '0x7fa9…c21e',
    detail: 'OFAC / sanctions screen — Chainalysis clear',
    amount: '—',
    route: 'CUSTODY POLICY',
    tone: 'ok',
  },
];

export default function UnifiedDashboard() {
  const { data: overview, live } = useForge<OverviewLive | null>('overview', null);
  const liveCount = overview
    ? [overview.custody, overview.wallet, overview.treasury, overview.bureau, overview.ontology].filter((s) => s?.live).length
    : 0;

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Unified Overview"
        title={
          <>
            The Revenue <em>Ontology</em>
          </>
        }
        lede="Every payment, signature, score, and sweep across six interconnected platforms — recorded once, consumed everywhere."
        actions={
          <>
            <LivePill live={live} />
            {live && <span className="pill accent">{liveCount} / 5 services online</span>}
            <Link href="/dashboard/ops" className="btn-ghost btn-sm">System Health</Link>
          </>
        }
      />

      <StatGrid>
        <Stat label="Ontology events / 24h" value="41,208" delta="+8.2% vs prior day" deltaTone="up" />
        <Stat label="Value settled / 24h" value="R63.4M" delta="+R4.1M" deltaTone="up" />
        <Stat label="Payment success" value="99.7%" delta="target ≥ 99.7%" />
        <Stat label="Custody signatures" value="12" delta="3 pending approval" />
        <Stat label="Active agent lines" value="R2.1M" delta="312 agents scored" />
        <Stat label="Consolidated cash" value="R48.6M" delta="14 accounts · 3 subsidiaries" />
      </StatGrid>

      {/* Routing tiers — the interconnection contract */}
      <Panel
        title="Payment Routing Tiers"
        label="FORGE Payments decision engine"
        ink
        style={{ marginBottom: 20 }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
            gap: 1,
            background: 'var(--hair-dark)',
            border: '1px solid var(--hair-dark)',
          }}
        >
          {[
            {
              tier: '< $100K',
              path: 'FORGE Wallet',
              desc: 'Consumer & agent transfers signed directly by the wallet layer. Biometric confirm, gas sponsored.',
              share: '92% of volume',
            },
            {
              tier: '$100K – $1M',
              path: 'FORGE Payments optimal path',
              desc: 'Routed across Stripe ACH → Circle USDC fallback chain for best cost and settlement time.',
              share: '7% of volume',
            },
            {
              tier: '> $1M',
              path: 'FORGE Custody',
              desc: 'Institutional transfers require policy evaluation, multi-party approval, and 4-of-7 threshold signing.',
              share: '1% of volume · 71% of value',
            },
          ].map((t) => (
            <div key={t.tier} style={{ background: 'var(--ink)', padding: '18px 20px' }}>
              <div className="mono" style={{ marginBottom: 8 }}>{t.tier}</div>
              <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 6 }}>{t.path}</div>
              <p className="lede" style={{ fontSize: 13.5, marginBottom: 10 }}>{t.desc}</p>
              <span className="mono" style={{ color: 'var(--accent)' }}>{t.share}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Platform tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))',
          gap: 20,
          marginBottom: 20,
        }}
      >
        {PLATFORMS.map((p) => (
          <Link key={p.href} href={p.href}>
            <div className="panel" style={{ padding: 20, height: '100%' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <span className="mono">{p.role}</span>
                <Pill tone={p.status}>{p.statusLabel}</Pill>
              </div>
              <div className="forge-h2" style={{ marginBottom: 8 }}>{p.name}</div>
              <div className="num" style={{ color: 'var(--steel)' }}>{p.metric}</div>
            </div>
          </Link>
        ))}
      </div>

      <Grid2>
        <Panel title="Ontology Event Stream" label="revenue_events · append-only">
          <DataTable
            columns={['Event', 'Actor', 'Detail', 'Amount', 'Route']}
            rows={ONTOLOGY_EVENTS.map((e) => [
              <Mono key="t">{e.type}</Mono>,
              <Addr key="a">{e.actor}</Addr>,
              e.detail,
              <Mono key="m">{e.amount}</Mono>,
              <Pill key="r" tone={e.tone}>{e.route}</Pill>,
            ])}
          />
        </Panel>

        <Panel title="Cross-Platform Flow" label="agent pays supplier on terms">
          <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
            {[
              ['01', 'FORGE Wallet', 'Agent did:forge:agent_001 initiates $50K USDC, net-30 terms.'],
              ['02', 'Agent Credit Bureau', 'Score 75/100 checked; requires credit extension past R25K line.'],
              ['03', 'Enterprise Treasury', 'Treasury manager approves extension to R100K — one click.'],
              ['04', 'FORGE Payments', 'Routes institutional-size credit transfer to Custody.'],
              ['05', 'FORGE Custody', 'Policy pass → approvals → 4-of-7 threshold signature → broadcast.'],
              ['06', 'Revenue Ontology', 'Confirmed event recorded once; every platform reads it.'],
              ['07', 'Agent Credit Bureau', 'On-time repayment lifts score 78 → 82; line grows to R250K.'],
            ].map(([n, sys, desc]) => (
              <li
                key={n}
                style={{
                  display: 'flex',
                  gap: 16,
                  padding: '11px 0',
                  borderBottom: '1px solid var(--hair)',
                  alignItems: 'baseline',
                }}
              >
                <span className="mono" style={{ minWidth: 24 }}>{n}</span>
                <span style={{ fontWeight: 500, minWidth: 170 }}>{sys}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </Grid2>
    </>
  );
}

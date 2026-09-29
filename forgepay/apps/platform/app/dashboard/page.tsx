'use client';

import { useEffect, useState } from 'react';
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
  custody: { live: boolean; data: { stats?: { signatures_24h?: number; pending_approval?: number; notional_24h_usd?: number } } | null };
  wallet: { live: boolean; data: { stats?: { total_wallets?: number; transactions_24h?: number } } | null };
  treasury: { live: boolean; data: { cash_position?: { data?: { totalUsd?: number } } } | null };
  bureau: { live: boolean; data: { stats?: { totalAgents?: number; totalDebt?: number; inquiries24h?: number } } | null };
  ontology: { live: boolean; data: { data?: OntologyEvent[] } | null };
}

interface OntologyEvent {
  id: string;
  type: string;
  source: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

/* ────────────────────────────────────────────────────────────────
   FORGE — Unified Ontology Overview
   One screen across every interconnected platform:
   Payments → Wallet (<$100K) → Custody (>$1M) with the Revenue
   Ontology as the single source of truth, consumed by the Agent
   Credit Bureau and Enterprise Treasury.
   Every tile and every number below is read from `overview` (the
   real per-service proxy composite) — a sub-service that isn't live
   renders as "—", never a placeholder number standing in for
   activity that hasn't happened.
   ──────────────────────────────────────────────────────────────── */

const money = (n: number) => `R${n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`}`;

interface PaymentsSummary { activated: boolean; stats: { events24h: number } }
const EMPTY_PAYMENTS: PaymentsSummary = { activated: false, stats: { events24h: 0 } };

export default function UnifiedDashboard() {
  const { data: overview, live } = useForge<OverviewLive | null>('overview', null);
  const { data: payments } = useForge<PaymentsSummary>('payments', EMPTY_PAYMENTS);
  const [enabled, setEnabled] = useState<Set<string> | null>(null);
  const liveCount = overview
    ? [overview.custody, overview.wallet, overview.treasury, overview.bureau, overview.ontology].filter((s) => s?.live).length
    : 0;

  useEffect(() => {
    fetch('/api/tenant/products').then((r) => r.json()).then((body) => {
      setEnabled(new Set(body.enabled ?? []));
    });
  }, []);

  const custody = overview?.custody?.live ? overview.custody.data?.stats : undefined;
  const wallet = overview?.wallet?.live ? overview.wallet.data?.stats : undefined;
  const treasury = overview?.treasury?.live ? overview.treasury.data?.cash_position?.data : undefined;
  const bureau = overview?.bureau?.live ? overview.bureau.data?.stats : undefined;
  const events = overview?.ontology?.live ? (overview.ontology.data?.data ?? []) : [];

  const ALL_PLATFORMS = [
    {
      href: '/dashboard/payments',
      key: 'payments',
      name: 'FORGE Payments',
      role: 'Routing & settlement',
      metric: payments.activated ? `${payments.stats.events24h} events / 24h` : 'not activated yet',
      live: payments.activated,
    },
    {
      href: '/dashboard/custody',
      key: 'custody',
      name: 'FORGE Custody',
      role: 'Institutional 4-of-7 threshold signing',
      metric: custody ? `${custody.signatures_24h ?? 0} signatures / 24h` : '—',
      live: !!custody,
    },
    {
      href: '/dashboard/wallet',
      key: 'wallet',
      name: 'FORGE Wallet',
      role: 'Consumer & agent wallets, did:forge identity',
      metric: wallet ? `${(wallet.total_wallets ?? 0).toLocaleString('en-US')} wallets` : '—',
      live: !!wallet,
    },
    {
      href: '/dashboard/agent-credit-bureau',
      key: 'credit-bureau',
      name: 'Agent Credit Bureau',
      role: 'Reputation & credit for autonomous agents',
      metric: bureau ? `${bureau.totalAgents ?? 0} agents scored` : '—',
      live: !!bureau,
    },
    {
      href: '/dashboard/enterprise-treasury',
      key: 'treasury',
      name: 'Enterprise Treasury',
      role: 'Consolidation, netting, credit approvals',
      metric: treasury?.totalUsd != null ? `$${(treasury.totalUsd / 1_000_000).toFixed(1)}M consolidated` : '—',
      live: !!treasury,
    },
    {
      href: '/dashboard/credit-bureau',
      key: 'credit-bureau',
      name: 'Credit Bureau',
      role: 'Dual-mode merchant scoring (Mode 1 / Mode 2)',
      metric: bureau ? `${bureau.inquiries24h ?? 0} inquiries / 24h` : '—',
      live: !!bureau,
    },
  ];

  const PLATFORMS = enabled ? ALL_PLATFORMS.filter((p) => enabled.has(p.key)) : [];

  if (enabled && enabled.size === 0) {
    return (
      <>
        <PageHeader
          eyebrow="FORGE / Unified Overview"
          title={
            <>
              Nothing is <em>turned on</em> yet
            </>
          }
          lede="Your console is empty because you haven't enabled any platform. Pick what you need — you can change this anytime."
        />
        <Panel title="Get started" label="every product below starts disabled for a new account">
          <p className="lede" style={{ fontSize: 13.5, marginBottom: 18 }}>
            Nothing here is pre-selected on sign-up, so the console has no data to show. Turn on
            a product to unlock its pages and start seeing real activity.
          </p>
          <Link href="/dashboard/products" className="btn-primary">Choose your products →</Link>
        </Panel>
      </>
    );
  }

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
            <span className="pill accent">{liveCount} / 5 services online</span>
            <Link href="/dashboard/ops" className="btn-ghost btn-sm">System Health</Link>
          </>
        }
      />

      <StatGrid>
        <Stat label="Ontology events / 24h" value={events.length} delta={overview?.ontology?.live ? 'from revenue_events' : 'ontology feed unreachable'} />
        <Stat label="Custody signatures / 24h" value={custody?.signatures_24h ?? '—'} delta={custody ? `${custody.pending_approval ?? 0} pending approval` : 'custody unreachable'} />
        <Stat label="Agent lines drawn" value={bureau?.totalDebt != null ? money(bureau.totalDebt) : '—'} delta={bureau ? `${bureau.totalAgents ?? 0} agents scored` : 'bureau unreachable'} />
        <Stat label="Consolidated cash" value={treasury?.totalUsd != null ? `$${(treasury.totalUsd / 1_000_000).toFixed(1)}M` : '—'} delta={treasury ? 'from cash-position' : 'treasury unreachable'} />
        <Stat label="Wallet transactions / 24h" value={wallet?.transactions_24h ?? '—'} delta={wallet ? `${(wallet.total_wallets ?? 0).toLocaleString('en-US')} wallets` : 'wallet unreachable'} />
        <Stat label="Services online" value={`${liveCount} / 5`} delta="custody · wallet · treasury · bureau · ontology" />
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
            },
            {
              tier: '$100K – $1M',
              path: 'FORGE Payments optimal path',
              desc: 'Routed across Stripe ACH → Circle USDC fallback chain for best cost and settlement time.',
            },
            {
              tier: '> $1M',
              path: 'FORGE Custody',
              desc: 'Institutional transfers require policy evaluation, multi-party approval, and 4-of-7 threshold signing.',
            },
          ].map((t) => (
            <div key={t.tier} style={{ background: 'var(--ink)', padding: '18px 20px' }}>
              <div className="mono" style={{ marginBottom: 8 }}>{t.tier}</div>
              <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 6 }}>{t.path}</div>
              <p className="lede" style={{ fontSize: 13.5 }}>{t.desc}</p>
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
                <Pill tone={p.live ? 'ok' : undefined}>{p.live ? 'live' : 'offline'}</Pill>
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
            columns={['When', 'Event', 'Source', 'Detail']}
            emptyMessage={overview?.ontology?.live ? 'No events recorded yet.' : 'Ontology feed unreachable.'}
            rows={events.map((e) => [
              <Mono key="w">{new Date(e.occurred_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Mono>,
              <Mono key="t">{e.type}</Mono>,
              <Addr key="a">{e.source}</Addr>,
              JSON.stringify(e.data).slice(0, 80),
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

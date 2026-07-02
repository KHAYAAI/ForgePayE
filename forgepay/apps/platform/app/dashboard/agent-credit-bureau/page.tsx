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
  Meter,
  Mono,
  Addr,
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau — reputation & credit for autonomous agents.
   Live-wired to agent-credit-bureau /v1/bureau/stats + /v1/agents
   via the /api/forge/bureau proxy; demo fixtures when offline.
   Scores are 0–1000 with FICO-style tiers.
   ──────────────────────────────────────────────────────────────── */

interface AgentProfileRow {
  agentId: string;
  did: string;
  operatorEntityId: string;
  currentScore: number; // 0–1000
  tier: string;
  totalDebt: number;
  totalCreditLimit: number;
  utilizationRate: number;
  paymentHistoryRate: number;
  frozenAt?: string;
}

interface BureauSummary {
  stats: {
    totalAgents: number;
    avgScore: number;
    totalDebt: number;
    totalCreditLimit: number;
    utilizationRate: number;
    delinquentAgents?: number;
    distribution?: Record<string, number>;
  };
  agents: AgentProfileRow[];
}

const DEMO: BureauSummary = {
  stats: {
    totalAgents: 312,
    avgScore: 710,
    totalDebt: 2_100_000,
    totalCreditLimit: 6_400_000,
    utilizationRate: 0.328,
    delinquentAgents: 3,
    distribution: { SUPER_PRIME: 41, PRIME: 148, NEAR_PRIME: 84, SUBPRIME: 30, DEEP_SUBPRIME: 9 },
  },
  agents: [
    { agentId: 'agent_001', did: 'did:forge:agent_001', operatorEntityId: 'Umuntu Group', currentScore: 820, tier: 'SUPER_PRIME', totalDebt: 0, totalCreditLimit: 250_000, utilizationRate: 0, paymentHistoryRate: 100 },
    { agentId: 'agent_114', did: 'did:forge:agent_114', operatorEntityId: 'SnapPay', currentScore: 750, tier: 'PRIME', totalDebt: 38_000, totalCreditLimit: 100_000, utilizationRate: 0.38, paymentHistoryRate: 100 },
    { agentId: 'agent_078', did: 'did:forge:agent_078', operatorEntityId: 'AfroBiz Lending', currentScore: 630, tier: 'NEAR_PRIME', totalDebt: 40_000, totalCreditLimit: 40_000, utilizationRate: 1.0, paymentHistoryRate: 90 },
    { agentId: 'agent_231', did: 'did:forge:agent_231', operatorEntityId: 'ComputeRent', currentScore: 705, tier: 'PRIME', totalDebt: 12_000, totalCreditLimit: 60_000, utilizationRate: 0.2, paymentHistoryRate: 97.8 },
    { agentId: 'agent_009', did: 'did:forge:agent_009', operatorEntityId: 'Umuntu Group', currentScore: 340, tier: 'DEEP_SUBPRIME', totalDebt: 25_000, totalCreditLimit: 0, utilizationRate: 1, paymentHistoryRate: 64.3, frozenAt: '2026-06-28' },
  ],
};

const TIER_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  SUPER_PRIME: 'ok',
  PRIME: 'ok',
  NEAR_PRIME: 'accent',
  SUBPRIME: 'warn',
  DEEP_SUBPRIME: 'danger',
};

const money = (n: number) => `R${n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`}`;

function tierLabel(score: number): string {
  if (score >= 800) return 'super prime';
  if (score >= 670) return 'prime';
  if (score >= 580) return 'near prime';
  if (score >= 500) return 'subprime';
  return 'deep subprime';
}

export default function AgentCreditBureau() {
  const { data, live } = useForge<BureauSummary>('bureau', DEMO);
  const [extensions, setExtensions] = useState([
    {
      id: 'ext_5501',
      did: 'did:forge:agent_001',
      reason: 'Supplier payment $50K exceeds current line',
      from: 'R25K',
      to: 'R100K',
      status: 'pending' as 'pending' | 'sent',
    },
  ]);

  const requestApproval = (id: string) =>
    setExtensions((xs) => xs.map((x) => (x.id === id ? { ...x, status: 'sent' } : x)));

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau"
        title={
          <>
            Credit for <em>autonomous agents</em>
          </>
        }
        lede="Every agent payment recorded in the Revenue Ontology feeds a live reputation score. Scores set credit lines; Enterprise Treasury approves extensions; repayment closes the loop."
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat label="Agents scored" value={data.stats.totalAgents.toLocaleString('en-US')} delta={live ? 'from bureau register' : '+18 this week'} />
        <Stat label="Avg score" value={`${data.stats.avgScore} / 1000`} delta={tierLabel(data.stats.avgScore)} />
        <Stat label="Credit drawn" value={money(data.stats.totalDebt)} delta={`of ${money(data.stats.totalCreditLimit)} extended`} />
        <Stat label="Utilization" value={`${Math.round(data.stats.utilizationRate * 100)}%`} delta="drawn / total limit" />
        <Stat label="Delinquent agents" value={data.stats.delinquentAgents ?? 0} deltaTone={(data.stats.delinquentAgents ?? 0) > 0 ? 'down' : undefined} delta="open delinquencies" />
        <Stat label="Extension requests" value={extensions.filter((x) => x.status === 'pending').length} delta="awaiting treasury" />
      </StatGrid>

      <Panel
        title="Credit Extension Queue"
        label="interacts with Enterprise Treasury"
        ink
        style={{ marginBottom: 20 }}
      >
        <DataTable
          columns={['Request', 'Agent', 'Reason', 'Line Change', 'Status', '']}
          rows={extensions.map((x) => [
            <Mono key="id">{x.id}</Mono>,
            <Addr key="d">{x.did}</Addr>,
            x.reason,
            <Mono key="c">{x.from} → {x.to}</Mono>,
            <Pill key="s" tone={x.status === 'sent' ? 'accent' : 'warn'}>
              {x.status === 'sent' ? 'sent to treasury' : 'pending'}
            </Pill>,
            x.status === 'pending' ? (
              <button key="b" className="btn-ghost btn-sm" onClick={() => requestApproval(x.id)}>
                Send to Treasury
              </button>
            ) : (
              <span key="b" className="mono">awaiting approval</span>
            ),
          ])}
        />
      </Panel>

      <Panel title="Agent Register" label="scores from ontology events · updated live" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Agent DID', 'Operator', 'Score', '', 'Tier', 'Credit Line', 'Drawn', 'On-time %', 'Status']}
          rows={data.agents.map((a) => [
            <Addr key="d">{a.did}</Addr>,
            a.operatorEntityId,
            <Mono key="s">{a.currentScore}</Mono>,
            <Meter key="m" pct={a.currentScore / 10} accent={a.currentScore >= 670} />,
            <Pill key="ti" tone={TIER_TONE[a.tier] ?? 'accent'}>{a.tier.replace('_', ' ').toLowerCase()}</Pill>,
            <Mono key="l">{money(a.totalCreditLimit)}</Mono>,
            <Mono key="dr">{money(a.totalDebt)}</Mono>,
            <Mono key="o">{a.paymentHistoryRate.toFixed(1)}%</Mono>,
            <Pill key="st" tone={a.frozenAt ? 'danger' : 'ok'}>{a.frozenAt ? 'frozen' : 'active'}</Pill>,
          ])}
        />
      </Panel>

      <Grid2>
        <Panel title="Scoring Model" label="event-driven · explainable">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['35%', 'Payment success rate', 'confirmed vs failed transfers from wallet + custody events'],
              ['30%', 'Volume consistency', 'amount variance across trailing 90 days'],
              ['20%', 'Compliance record', 'sanctions screens, policy rejections, chargebacks'],
              ['15%', 'Account age', 'time since did:forge registration'],
            ].map(([w, factor, desc]) => (
              <li key={factor} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 40 }}>{w}</span>
                <span style={{ fontWeight: 500, minWidth: 180 }}>{factor}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Score changes are event-sourced: each `wallet.transaction.confirmed` and
            `custody.signature.confirmed` ontology event replays into the model, so every score is
            auditable back to the transactions that produced it.
          </p>
        </Panel>

        <Panel title="Credit Line Ladder" label="score → automatic limit">
          <DataTable
            columns={['Tier (score)', 'Line', 'Terms', 'Fee']}
            rows={[
              [<Mono key="b">super prime (800+)</Mono>, <Mono key="l">up to R250K</Mono>, 'net-30 / net-60', <Mono key="f">1.0%</Mono>],
              [<Mono key="b">prime (670–799)</Mono>, <Mono key="l">up to R100K</Mono>, 'net-30', <Mono key="f">1.5%</Mono>],
              [<Mono key="b">near prime (580–669)</Mono>, <Mono key="l">up to R40K</Mono>, 'net-14', <Mono key="f">2.0%</Mono>],
              [<Mono key="b">subprime (500–579)</Mono>, <Mono key="l">up to R10K</Mono>, 'net-7 · prepaid gas', <Mono key="f">2.5%</Mono>],
              [<Mono key="b">{'deep subprime (< 500)'}</Mono>, <Mono key="l">frozen</Mono>, 'repayment plan required', <Mono key="f">—</Mono>],
            ]}
          />
        </Panel>
      </Grid2>
    </>
  );
}

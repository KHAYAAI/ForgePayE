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
import { GRADE_SCALE, INQUIRY_FEE_USD, gradeFor, gradeTone } from '@/lib/credit-grade';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau — reputation & credit for autonomous agents.
   Live-wired to agent-credit-bureau /v1/bureau/stats + /v1/agents
   via the /api/forge/bureau proxy; demo fixtures when offline.
   Scores are 0–1000 with FICO-style tiers and AAA–D letter grades.
   Dual-mode: Mode 1 (FORGE FICO, authoritative) + Mode 2
   (operational, Qova-derived factors) — see /v1/agents/:id/dual-score.
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
    inquiries24h?: number;
    inquiriesTotal?: number;
    inquiryFeeUsd?: number;
    inquiryRevenueUsd?: number;
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
    inquiries24h: 487,
    inquiriesTotal: 14_600,
    inquiryFeeUsd: INQUIRY_FEE_USD,
    inquiryRevenueUsd: 40_880,
  },
  agents: [
    { agentId: 'agent_001', did: 'did:forge:agent_001', operatorEntityId: 'Umuntu Group', currentScore: 820, tier: 'SUPER_PRIME', totalDebt: 0, totalCreditLimit: 250_000, utilizationRate: 0, paymentHistoryRate: 100 },
    { agentId: 'agent_114', did: 'did:forge:agent_114', operatorEntityId: 'SnapPay', currentScore: 750, tier: 'PRIME', totalDebt: 38_000, totalCreditLimit: 100_000, utilizationRate: 0.38, paymentHistoryRate: 100 },
    { agentId: 'agent_078', did: 'did:forge:agent_078', operatorEntityId: 'AfroBiz Lending', currentScore: 630, tier: 'NEAR_PRIME', totalDebt: 40_000, totalCreditLimit: 40_000, utilizationRate: 1.0, paymentHistoryRate: 90 },
    { agentId: 'agent_231', did: 'did:forge:agent_231', operatorEntityId: 'ComputeRent', currentScore: 705, tier: 'PRIME', totalDebt: 12_000, totalCreditLimit: 60_000, utilizationRate: 0.2, paymentHistoryRate: 97.8 },
    { agentId: 'agent_009', did: 'did:forge:agent_009', operatorEntityId: 'Umuntu Group', currentScore: 340, tier: 'DEEP_SUBPRIME', totalDebt: 25_000, totalCreditLimit: 0, utilizationRate: 1, paymentHistoryRate: 64.3, frozenAt: '2026-06-28' },
  ],
};

/* Demo verification run — mirrors POST /v1/agents/:id/verify (8 checks). */
const DEMO_VERIFY = {
  did: 'did:forge:agent_114',
  status: 'VERIFIED' as const,
  checksPassed: 8,
  checks: [
    { check: 'registration', passed: true, detail: 'Registered with the bureau since 2025-03-14.' },
    { check: 'identity_bound', passed: true, detail: 'did:forge:agent_114 bound to SnapPay (llc).' },
    { check: 'account_age', passed: true, detail: '16 months of history (minimum 3).' },
    { check: 'operator_consistency', passed: true, detail: 'Operator entity type on record: llc.' },
    { check: 'activity_level', passed: true, detail: '1,204 credit events recorded (minimum 5).' },
    { check: 'history_stability', passed: true, detail: 'No open delinquencies or defaults.' },
    { check: 'sanctions_screen', passed: true, detail: 'No sanctions hits on record; profile active.' },
    { check: 'minimum_score', passed: true, detail: 'Score 750 (minimum 500).' },
  ],
};

const TIER_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  SUPER_PRIME: 'ok',
  PRIME: 'ok',
  NEAR_PRIME: 'accent',
  SUBPRIME: 'warn',
  DEEP_SUBPRIME: 'danger',
};

const VERIFY_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  VERIFIED: 'ok',
  PARTIALLY_VERIFIED: 'accent',
  UNVERIFIED: 'warn',
  SUSPICIOUS: 'danger',
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

  const inquiries24h = data.stats.inquiries24h ?? DEMO.stats.inquiries24h ?? 0;
  const feeUsd = data.stats.inquiryFeeUsd ?? INQUIRY_FEE_USD;

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau"
        title={
          <>
            Credit for <em>autonomous agents</em>
          </>
        }
        lede="Every agent payment recorded in the Revenue Ontology feeds a live reputation score — 0–1000 with an AAA–D grade, priced like a traditional bureau at $2.80 per inquiry. Scores set credit lines; Enterprise Treasury approves extensions; repayment closes the loop."
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat label="Agents scored" value={data.stats.totalAgents.toLocaleString('en-US')} delta={live ? 'from bureau register' : '+18 this week'} />
        <Stat label="Avg score" value={`${data.stats.avgScore} / 1000`} delta={`${gradeFor(data.stats.avgScore).grade} · ${tierLabel(data.stats.avgScore)}`} />
        <Stat label="Inquiries / 24h" value={inquiries24h.toLocaleString('en-US')} delta={`$${feeUsd.toFixed(2)} per pull`} />
        <Stat label="Inquiry revenue" value={`$${Math.round((data.stats.inquiryRevenueUsd ?? inquiries24h * feeUsd)).toLocaleString('en-US')}`} delta="metered · to date" deltaTone="up" />
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
          columns={['Agent DID', 'Operator', 'Score', '', 'Grade', 'Tier', 'Credit Line', 'Drawn', 'On-time %', 'Status']}
          rows={data.agents.map((a) => {
            const g = gradeFor(a.currentScore);
            return [
              <Addr key="d">{a.did}</Addr>,
              a.operatorEntityId,
              <Mono key="s">{a.currentScore}</Mono>,
              <Meter key="m" pct={a.currentScore / 10} accent={a.currentScore >= 670} />,
              <Pill key="g" tone={gradeTone(g.grade)}>{g.grade}</Pill>,
              <Pill key="ti" tone={TIER_TONE[a.tier] ?? 'accent'}>{a.tier.replace('_', ' ').toLowerCase()}</Pill>,
              <Mono key="l">{money(a.totalCreditLimit)}</Mono>,
              <Mono key="dr">{money(a.totalDebt)}</Mono>,
              <Mono key="o">{a.paymentHistoryRate.toFixed(1)}%</Mono>,
              <Pill key="st" tone={a.frozenAt ? 'danger' : 'ok'}>{a.frozenAt ? 'frozen' : 'active'}</Pill>,
            ];
          })}
        />
      </Panel>

      <Grid2>
        <Panel title="Mode 1 — FORGE FICO" label="authoritative for lending · off-chain · <15ms">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['35%', 'Payment history', 'on-time rate, open delinquencies, defaults on record'],
              ['30%', 'Credit utilization', 'total drawn / total limit across all credit lines'],
              ['15%', 'Age of credit', 'months since the first credit event'],
              ['10%', 'Credit mix', 'diversity of event types on record'],
              ['10%', 'New credit velocity', 'hard inquiries in the last 30 days'],
            ].map(([w, factor, desc]) => (
              <li key={factor} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 40 }}>{w}</span>
                <span style={{ fontWeight: 500, minWidth: 165 }}>{factor}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Event-sourced: each ontology event replays into the model, so every score is auditable
            back to the transactions that produced it. Mode 1 is always the lending decision.
          </p>
        </Panel>

        <Panel title="Mode 2 — Operational" label="behavioral lens · Qova-derived · on-chain verifiable">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['30%', 'Success rate', 'confirmed vs failed transactions from wallet + custody events'],
              ['25%', 'Transaction volume', 'total settled USD volume, tiered'],
              ['20%', 'Transaction count', 'depth of recorded activity'],
              ['15%', 'Budget compliance', 'spend attempts within configured limits'],
              ['10%', 'Account age', 'months of operational history'],
            ].map(([w, factor, desc]) => (
              <li key={factor} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 40 }}>{w}</span>
                <span style={{ fontWeight: 500, minWidth: 165 }}>{factor}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Both modes are compared on every dual-score pull: agreement within 50 points is high
            consensus; a divergence over 100 points flags the agent for manual review.
          </p>
        </Panel>
      </Grid2>

      <Panel title="Credit Rating Scale" label="published AAA–D grades · GET /v1/grade-scale" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Grade', 'Score', 'Risk level', 'What it means', 'Investment grade']}
          rows={GRADE_SCALE.map((b) => [
            <Pill key="g" tone={gradeTone(b.grade)}>{b.grade}</Pill>,
            <Mono key="r">{b.min}–{b.max}</Mono>,
            b.riskLevel,
            b.meaning,
            <Mono key="i">{b.investmentGrade ? 'yes' : '—'}</Mono>,
          ])}
        />
      </Panel>

      <Grid2>
        <Panel title="Agent Verification" label="8 checks · POST /v1/agents/:id/verify" ink>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <Addr>{DEMO_VERIFY.did}</Addr>
            <Pill tone={VERIFY_TONE[DEMO_VERIFY.status]}>{DEMO_VERIFY.status.replace('_', ' ').toLowerCase()}</Pill>
            <Mono>{DEMO_VERIFY.checksPassed} / 8 checks</Mono>
          </div>
          <ol style={{ listStyle: 'none' }}>
            {DEMO_VERIFY.checks.map((c) => (
              <li key={c.check} style={{ display: 'flex', gap: 14, padding: '9px 0', borderBottom: '1px solid rgba(244,242,238,0.14)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 16 }}>{c.passed ? '✓' : '✗'}</span>
                <span className="mono" style={{ minWidth: 168 }}>{c.check}</span>
                <span style={{ fontSize: 13, opacity: 0.75 }}>{c.detail}</span>
              </li>
            ))}
          </ol>
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Any sanctions exposure returns <strong>SUSPICIOUS</strong> regardless of other checks.
            Six or seven passes read as partially verified; all eight verify the agent.
          </p>
        </Panel>

        <Panel title="Framework Integrations" label="score gates inside agent frameworks">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['@forge/langgraph', 'Score-gated tools', 'a checkNode() blocks tool execution when the agent grades below threshold; outcomes recorded back for scoring'],
              ['@forge/crewai', 'Trust delegation', 'routes tasks by grade tier — 800+ for high-value, 650+ standard, 450+ low-value — to the highest-scored eligible agent'],
              ['@forge/n8n', 'No-code nodes', 'Score Check, Verify Agent and Record Outcome nodes for visual workflows; branch on grade with an IF node'],
            ].map(([pkg, use, desc]) => (
              <li key={pkg} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 140 }}>{pkg}</span>
                <span style={{ fontWeight: 500, minWidth: 118 }}>{use}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Every gate check is a metered ${feeUsd.toFixed(2)} bureau inquiry — the integrations are
            how inquiry volume compounds: one agent pipeline can pull hundreds of scores a day.
          </p>
        </Panel>
      </Grid2>

      <Grid2>
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

        <Panel title="Bureau Pricing" label="priced like a traditional bureau">
          <ol style={{ listStyle: 'none' }}>
            {[
              [`$${feeUsd.toFixed(2)}`, 'Score inquiry', 'per pull — score, grade, tier and top factors'],
              ['$2.80', 'Dual-mode score', 'Mode 1 + Mode 2 with consensus analysis, same metered rate'],
              ['$2.80', 'Verification', '8-check agent verify incl. sanctions screen'],
              ['Free', 'Outcome recording', 'posting events back builds the file — contributors earn query credits'],
            ].map(([price, item, desc]) => (
              <li key={item} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 52 }}>{price}</span>
                <span style={{ fontWeight: 500, minWidth: 150 }}>{item}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </Grid2>
    </>
  );
}

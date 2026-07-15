'use client';

import { useState } from 'react';
import {
  PageHeader,
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
import { gradeFor, gradeTone } from '@/lib/credit-grade';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau — Agents.
   The full register (GET /v1/agents) with a drill-in credit file
   per agent: score factors, credit events, delinquencies, inquiries.
   ──────────────────────────────────────────────────────────────── */

interface AgentProfileRow {
  agentId: string;
  did: string;
  operatorEntityId: string;
  currentScore: number;
  tier: string;
  totalDebt: number;
  totalCreditLimit: number;
  utilizationRate: number;
  paymentHistoryRate: number;
  frozenAt?: string;
}

interface BureauSummary {
  agents: AgentProfileRow[];
}

const DEMO: BureauSummary = {
  agents: [
    { agentId: 'agent_001', did: 'did:forge:agent_001', operatorEntityId: 'Umuntu Group', currentScore: 820, tier: 'SUPER_PRIME', totalDebt: 0, totalCreditLimit: 250_000, utilizationRate: 0, paymentHistoryRate: 100 },
    { agentId: 'agent_114', did: 'did:forge:agent_114', operatorEntityId: 'SnapPay', currentScore: 750, tier: 'PRIME', totalDebt: 38_000, totalCreditLimit: 100_000, utilizationRate: 0.38, paymentHistoryRate: 100 },
    { agentId: 'agent_078', did: 'did:forge:agent_078', operatorEntityId: 'AfroBiz Lending', currentScore: 630, tier: 'NEAR_PRIME', totalDebt: 40_000, totalCreditLimit: 40_000, utilizationRate: 1.0, paymentHistoryRate: 90 },
    { agentId: 'agent_231', did: 'did:forge:agent_231', operatorEntityId: 'ComputeRent', currentScore: 705, tier: 'PRIME', totalDebt: 12_000, totalCreditLimit: 60_000, utilizationRate: 0.2, paymentHistoryRate: 97.8 },
    { agentId: 'agent_009', did: 'did:forge:agent_009', operatorEntityId: 'Umuntu Group', currentScore: 340, tier: 'DEEP_SUBPRIME', totalDebt: 25_000, totalCreditLimit: 0, utilizationRate: 1, paymentHistoryRate: 64.3, frozenAt: '2026-06-28' },
  ],
};

/* Per-agent credit file detail — mirrors GET /v1/agents/:id/profile + /history. */
const FILES: Record<string, {
  factors: Array<{ code: string; impact: 'positive' | 'negative' | 'neutral'; weight: number; description: string }>;
  events: Array<{ at: string; type: string; detail: string; amount?: string }>;
}> = {
  agent_114: {
    factors: [
      { code: 'STRONG_PAYMENT_HISTORY', impact: 'positive', weight: 35, description: '100% of payments made on time.' },
      { code: 'HIGH_UTILIZATION', impact: 'negative', weight: 30, description: 'Credit utilization at 38% — approaching the 50% threshold.' },
      { code: 'ESTABLISHED_HISTORY', impact: 'positive', weight: 15, description: '16 months of credit history.' },
      { code: 'DIVERSE_CREDIT_MIX', impact: 'positive', weight: 10, description: 'Diverse mix of credit types and activity.' },
    ],
    events: [
      { at: '07:12', type: 'payment_on_time', detail: 'Net-30 repayment to fp_internal', amount: 'R12,000' },
      { at: 'Jun 30', type: 'credit_opened', detail: 'Line increase approved by Treasury', amount: 'R25,000' },
      { at: 'Jun 28', type: 'hard_inquiry', detail: 'Investec — credit_application', amount: '$2.80' },
      { at: 'Jun 21', type: 'payment_on_time', detail: 'Net-30 repayment to fp_internal', amount: 'R12,000' },
    ],
  },
  agent_009: {
    factors: [
      { code: 'RECENT_DEFAULT', impact: 'negative', weight: 35, description: 'One or more accounts in default significantly impact the score.' },
      { code: 'HIGH_UTILIZATION', impact: 'negative', weight: 30, description: 'Credit utilization at 100% — above the 50% threshold.' },
      { code: 'SHORT_CREDIT_HISTORY', impact: 'negative', weight: 15, description: 'Account is 4 months old — limited history available.' },
      { code: 'HIGH_INQUIRY_VELOCITY', impact: 'negative', weight: 10, description: '3 hard inquiries in the last 30 days — may indicate credit stress.' },
    ],
    events: [
      { at: 'Jun 28', type: 'sanctions_hit', detail: 'Operator entity matched screening list — profile frozen', amount: '—' },
      { at: 'Jun 27', type: 'payment_late_90', detail: 'R25,000 delinquency reached 90 days', amount: 'R25,000' },
      { at: 'Jun 02', type: 'hard_inquiry', detail: 'AfroBiz Lending — credit_application', amount: '$2.80' },
    ],
  },
};

const TIER_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  SUPER_PRIME: 'ok',
  PRIME: 'ok',
  NEAR_PRIME: 'accent',
  SUBPRIME: 'warn',
  DEEP_SUBPRIME: 'danger',
};

const IMPACT_TONE: Record<string, 'ok' | 'warn' | 'danger'> = {
  positive: 'ok',
  neutral: 'warn',
  negative: 'danger',
};

const money = (n: number) => `R${n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`}`;

export default function BureauAgents() {
  const { data, live } = useForge<BureauSummary>('bureau', DEMO);
  const [selected, setSelected] = useState('agent_114');

  const agents = data.agents?.length ? data.agents : DEMO.agents;
  const agent = agents.find((a) => a.agentId === selected) ?? agents[0];
  const file = FILES[agent.agentId] ?? FILES['agent_114'];
  const g = gradeFor(agent.currentScore);

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau / Agents"
        title={
          <>
            The agent <em>register</em>
          </>
        }
        lede="Every scored agent with its full credit file — factors, events, delinquencies and who pulled the report. Select a row to open the file."
        actions={<LivePill live={live} />}
      />

      <Panel title="Agent Register" label="GET /v1/agents · select a row for the credit file" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['', 'Agent DID', 'Operator', 'Score', '', 'Grade', 'Tier', 'Line', 'Drawn', 'On-time %', 'Status']}
          rows={agents.map((a) => {
            const ag = gradeFor(a.currentScore);
            return [
              <button
                key="sel"
                className="btn-ghost btn-sm"
                onClick={() => setSelected(a.agentId)}
                style={a.agentId === agent.agentId ? { background: 'var(--ink)', color: 'var(--paper)' } : undefined}
              >
                {a.agentId === agent.agentId ? 'open' : 'view'}
              </button>,
              <Addr key="d">{a.did}</Addr>,
              a.operatorEntityId,
              <Mono key="s">{a.currentScore}</Mono>,
              <Meter key="m" pct={a.currentScore / 10} accent={a.currentScore >= 670} />,
              <Pill key="g" tone={gradeTone(ag.grade)}>{ag.grade}</Pill>,
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
        <Panel
          title={`Credit File — ${agent.did}`}
          label={`score ${agent.currentScore} · grade ${g.grade} (${g.riskLevel.toLowerCase()} risk)`}
          ink
        >
          <ol style={{ listStyle: 'none' }}>
            {file.factors.map((f) => (
              <li key={f.code} style={{ display: 'flex', gap: 14, padding: '10px 0', borderBottom: '1px solid rgba(244,242,238,0.14)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 34 }}>{f.weight}%</span>
                <Pill tone={IMPACT_TONE[f.impact]}>{f.impact}</Pill>
                <span style={{ fontSize: 13, opacity: 0.85 }}>
                  <span className="mono" style={{ marginRight: 8 }}>{f.code}</span>
                  {f.description}
                </span>
              </li>
            ))}
          </ol>
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Factors are the top reasons for the score, ranked by model weight — the same
            explainability a lender sees on a pulled report.
          </p>
        </Panel>

        <Panel title="Credit Events" label="GET /v1/agents/:id/history · newest first">
          <DataTable
            columns={['When', 'Event', 'Detail', 'Amount']}
            rows={file.events.map((e, i) => [
              <Mono key={`w${i}`}>{e.at}</Mono>,
              <Mono key={`t${i}`}>{e.type}</Mono>,
              e.detail,
              <Mono key={`a${i}`}>{e.amount ?? '—'}</Mono>,
            ])}
          />
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Hard inquiries are themselves credit events — every $2.80 pull is on the file, visible
            to the agent's operator, and disputable under the FCRA-style process in Disputes.
          </p>
        </Panel>
      </Grid2>
    </>
  );
}

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

const EMPTY: BureauSummary = { agents: [] };

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

interface AgentFile {
  factors: Array<{ code: string; impact: 'positive' | 'negative' | 'neutral'; weight: number; description: string }>;
  events: Array<{ at: string; type: string; detail: string; amount?: string }>;
}

const EMPTY_FILE: AgentFile = { factors: [], events: [] };

export default function BureauAgents() {
  const { data, live } = useForge<BureauSummary>('bureau', EMPTY);
  const [selected, setSelected] = useState<string | null>(null);

  const agents = data.agents ?? [];
  const agent = agents.find((a) => a.agentId === selected) ?? agents[0] ?? null;

  // Per-agent credit file — factors + history — fetched separately per
  // selection since the register (above) carries only summary fields.
  const { data: file, live: fileLive } = useForge<AgentFile>(
    agent ? `bureau-agent-detail?agentId=${encodeURIComponent(agent.agentId)}` : 'bureau-agent-detail',
    EMPTY_FILE,
  );
  const g = agent ? gradeFor(agent.currentScore) : null;

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
          emptyMessage="No agents scored yet — the register fills as agents transact through FORGE."
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
          title={agent ? `Credit File — ${agent.did}` : 'Credit File'}
          label={agent && g ? `score ${agent.currentScore} · grade ${g.grade} (${g.riskLevel.toLowerCase()} risk)` : 'select an agent above'}
          ink
        >
          {agent ? (
            <>
              <ol style={{ listStyle: 'none' }}>
                {file.factors.length === 0 && (
                  <li style={{ padding: '10px 0', color: 'rgba(244,242,238,0.6)', fontStyle: 'italic' }}>
                    No score factors on file yet.
                  </li>
                )}
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
            </>
          ) : (
            <p className="lede" style={{ fontSize: 13 }}>No agents in the register yet.</p>
          )}
        </Panel>

        <Panel title="Credit Events" label="GET /v1/agents/:id/history · newest first">
          <DataTable
            columns={['When', 'Event', 'Detail', 'Amount']}
            emptyMessage={agent ? 'No credit events on file yet.' : 'No agent selected.'}
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

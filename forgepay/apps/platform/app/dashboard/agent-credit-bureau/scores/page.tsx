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
import { gradeFor, gradeTone } from '@/lib/credit-grade';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau — Scores (dual-mode analysis).
   Mode 1 (rules-based, authoritative) vs Mode 2 (operational,
   Qova-derived) with consensus levels, variance flags and
   on-chain settlement receipts.
   Mirrors GET /v1/agents/:id/dual-score + /v1/settlement/status.
   ──────────────────────────────────────────────────────────────── */

interface DualRow {
  did: string;
  operator: string;
  mode1: number;
  mode2: number | null;
  mode2Reason?: string | null;
  consensus: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  decision: string;
  settled: boolean;
}

interface Settlement {
  did: string;
  txHash: string;
  block: number;
  chain: string;
  settledAt: string;
}

interface ScoresSummary {
  dualRows: DualRow[];
  settlements: Settlement[];
}

const EMPTY: ScoresSummary = { dualRows: [], settlements: [] };

const CONSENSUS_TONE: Record<string, 'ok' | 'warn' | 'danger'> = {
  HIGH: 'ok',
  MEDIUM: 'warn',
  LOW: 'danger',
};

const DECISION_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  approve: 'ok',
  approve_with_conditions: 'accent',
  manual_review: 'warn',
  decline: 'danger',
};

export default function BureauScores() {
  const { data, live } = useForge<ScoresSummary>('bureau-scores', EMPTY);
  const dualRows = data.dualRows ?? [];
  const settlements = data.settlements ?? [];

  const hasRows = dualRows.length > 0;
  // Mode 2 exists only for agents with on-chain data; averages and variance
  // are over those agents alone.
  const withMode2 = dualRows.filter((r): r is DualRow & { mode2: number } => r.mode2 !== null);
  const hasMode2 = withMode2.length > 0;
  const variances = withMode2.map((r) => Math.abs(r.mode1 - r.mode2));
  const flagged = dualRows.filter((r) => r.consensus !== null && r.consensus !== 'HIGH').length;
  const avgMode1 = hasRows ? Math.round(dualRows.reduce((s, r) => s + r.mode1, 0) / dualRows.length) : null;
  const avgMode2 = hasMode2 ? Math.round(withMode2.reduce((s, r) => s + r.mode2, 0) / withMode2.length) : null;

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau / Scores"
        title={
          <>
            Two lenses, <em>one decision</em>
          </>
        }
        lede="Every dual-score pull computes Mode 1 (the rules-based score that drives the lending decision) and, where the agent has on-chain data, Mode 2 (operational behaviour) side by side. Agreement builds confidence; divergence flags the agent before credit is extended."
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat label="Avg Mode 1 score" value={hasRows ? `${avgMode1}` : '—'} delta={hasRows ? `${gradeFor(avgMode1!).grade} · lending lens` : 'no scores yet'} />
        <Stat label="Avg Mode 2 score" value={hasMode2 ? `${avgMode2}` : '—'} delta={hasMode2 ? `${gradeFor(avgMode2!).grade} · ${withMode2.length} of ${dualRows.length} agents` : 'no on-chain data yet'} />
        <Stat label="Variance flags" value={flagged} deltaTone={flagged > 0 ? 'down' : undefined} delta="consensus below HIGH" />
        <Stat label="Max variance" value={hasMode2 ? `${Math.max(...variances)} pts` : '—'} delta=">100 pts → manual review" />
        <Stat label="Settled on-chain" value={settlements.length} delta="external verification" />
      </StatGrid>

      <Panel title="Dual-Score Register" label="GET /v1/agents/:id/dual-score · Mode 1 is authoritative" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Agent DID', 'Operator', 'Mode 1', 'Grade', 'Mode 2', 'Grade', 'Variance', 'Consensus', 'Decision']}
          emptyMessage="No dual-scores computed yet."
          rows={dualRows.map((r) => {
            const g1 = gradeFor(r.mode1);
            const g2 = r.mode2 !== null ? gradeFor(r.mode2) : null;
            const variance = r.mode2 !== null ? Math.abs(r.mode1 - r.mode2) : null;
            return [
              <Addr key="d">{r.did}</Addr>,
              r.operator,
              <Mono key="m1">{r.mode1}</Mono>,
              <Pill key="g1" tone={gradeTone(g1.grade)}>{g1.grade}</Pill>,
              <Mono key="m2">{r.mode2 ?? <span title={r.mode2Reason ?? undefined}>—</span>}</Mono>,
              g2 ? <Pill key="g2" tone={gradeTone(g2.grade)}>{g2.grade}</Pill> : '—',
              <Mono key="v">{variance !== null ? `${variance} pts` : '—'}</Mono>,
              r.consensus ? <Pill key="c" tone={CONSENSUS_TONE[r.consensus]}>{r.consensus.toLowerCase()}</Pill> : 'no on-chain data',
              <Pill key="dec" tone={DECISION_TONE[r.decision]}>{r.decision.replace(/_/g, ' ')}</Pill>,
            ];
          })}
        />
      </Panel>

      <Grid2>
        <Panel title="Consensus Rules" label="variance between the two modes">
          <DataTable
            columns={['Level', 'Variance', 'Meaning']}
            rows={[
              [<Pill key="l" tone="ok">high</Pill>, <Mono key="v">≤ 50 pts</Mono>, 'Both lenses agree — high confidence in the Mode 1 decision.'],
              [<Pill key="l" tone="warn">medium</Pill>, <Mono key="v">51–100 pts</Mono>, 'Review recommended before large credit decisions.'],
              [<Pill key="l" tone="danger">low</Pill>, <Mono key="v">&gt; 100 pts</Mono>, 'Behavior and credit file misaligned — manual review required.'],
            ]}
          />
        </Panel>

        <Panel title="On-Chain Settlement" label="Mode 2 scores settle for external verification" ink>
          <DataTable
            columns={['Agent', 'Tx', 'Block', 'Chain', 'Settled']}
            emptyMessage="No Mode 2 scores have settled on-chain yet."
            rows={settlements.map((s) => [
              <Addr key="d">{s.did}</Addr>,
              <Mono key="t">{s.txHash}</Mono>,
              <Mono key="b">{s.block.toLocaleString('en-US')}</Mono>,
              s.chain,
              <Mono key="at">{s.settledAt}</Mono>,
            ])}
          />
        </Panel>
      </Grid2>
    </>
  );
}

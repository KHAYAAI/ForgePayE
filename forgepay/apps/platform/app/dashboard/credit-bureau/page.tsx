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
import { INQUIRY_FEE_USD, gradeFor, gradeTone } from '@/lib/credit-grade';

/* ────────────────────────────────────────────────────────────────
   Credit Bureau — Dual-Mode deep dive.
   Mode 1 (FORGE FICO, off-chain, authoritative) vs Mode 2
   (operational, Qova-derived, on-chain settleable), with consensus
   analysis and settlement receipts. Mirrors the shape of
   GET /v1/agents/:id/dual-score and /v1/settlement/status.
   ──────────────────────────────────────────────────────────────── */

interface BureauStats {
  stats: {
    totalAgents: number;
    avgScore: number;
    inquiries24h?: number;
    inquiryFeeUsd?: number;
    inquiryRevenueUsd?: number;
  };
}

const DEMO_STATS: BureauStats = {
  stats: {
    totalAgents: 312,
    avgScore: 710,
    inquiries24h: 487,
    inquiryFeeUsd: INQUIRY_FEE_USD,
    inquiryRevenueUsd: 40_880,
  },
};

/* Demo dual-score rows — one per GET /v1/agents/:id/dual-score pull. */
const DUAL_ROWS = [
  { did: 'did:forge:agent_001', operator: 'Umuntu Group', mode1: 820, mode2: 805, consensus: 'HIGH' as const, decision: 'approve', settled: true },
  { did: 'did:forge:agent_114', operator: 'SnapPay', mode1: 750, mode2: 772, consensus: 'HIGH' as const, decision: 'approve', settled: true },
  { did: 'did:forge:agent_231', operator: 'ComputeRent', mode1: 705, mode2: 640, consensus: 'MEDIUM' as const, decision: 'approve_with_conditions', settled: true },
  { did: 'did:forge:agent_078', operator: 'AfroBiz Lending', mode1: 630, mode2: 498, consensus: 'LOW' as const, decision: 'manual_review', settled: false },
  { did: 'did:forge:agent_009', operator: 'Umuntu Group', mode1: 340, mode2: 361, consensus: 'HIGH' as const, decision: 'decline', settled: false },
];

/* Demo settlement receipts — mirrors /v1/settlement/status + receipts. */
const SETTLEMENTS = [
  { did: 'did:forge:agent_001', txHash: '0x8c1f…a2e4', block: 18_442_071, chain: 'base', settledAt: '14:02' },
  { did: 'did:forge:agent_114', txHash: '0x77b0…19dd', block: 18_442_071, chain: 'base', settledAt: '14:02' },
  { did: 'did:forge:agent_231', txHash: '0x51ac…f003', block: 18_437_990, chain: 'base', settledAt: '08:02' },
];

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

export default function CreditBureauDualMode() {
  const { data, live } = useForge<BureauStats>('bureau', DEMO_STATS);

  const feeUsd = data.stats.inquiryFeeUsd ?? INQUIRY_FEE_USD;
  const variances = DUAL_ROWS.map((r) => Math.abs(r.mode1 - r.mode2));
  const flagged = DUAL_ROWS.filter((r) => r.consensus !== 'HIGH').length;
  const avgMode1 = Math.round(DUAL_ROWS.reduce((s, r) => s + r.mode1, 0) / DUAL_ROWS.length);
  const avgMode2 = Math.round(DUAL_ROWS.reduce((s, r) => s + r.mode2, 0) / DUAL_ROWS.length);

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Credit Bureau · Dual-Mode"
        title={
          <>
            Two lenses, <em>one decision</em>
          </>
        }
        lede="Every dual-score pull computes Mode 1 (FORGE FICO — the lending decision) and Mode 2 (operational behavior, Qova-derived) side by side. Agreement builds confidence; divergence flags the agent before credit is extended."
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat label="Inquiries / 24h" value={(data.stats.inquiries24h ?? 0).toLocaleString('en-US')} delta={`$${feeUsd.toFixed(2)} per pull`} />
        <Stat label="Avg Mode 1 score" value={`${avgMode1}`} delta={`${gradeFor(avgMode1).grade} · FICO lens`} />
        <Stat label="Avg Mode 2 score" value={`${avgMode2}`} delta={`${gradeFor(avgMode2).grade} · operational lens`} />
        <Stat label="Variance flags" value={flagged} deltaTone={flagged > 0 ? 'down' : undefined} delta="consensus below HIGH" />
        <Stat label="Max variance" value={`${Math.max(...variances)} pts`} delta=">100 pts → manual review" />
        <Stat label="Inquiry revenue" value={`$${Math.round(data.stats.inquiryRevenueUsd ?? 0).toLocaleString('en-US')}`} delta="metered · to date" deltaTone="up" />
      </StatGrid>

      <Panel title="Dual-Score Register" label="GET /v1/agents/:id/dual-score · Mode 1 is authoritative" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Agent DID', 'Operator', 'Mode 1', 'Grade', 'Mode 2', 'Grade', 'Variance', 'Consensus', 'Decision']}
          rows={DUAL_ROWS.map((r) => {
            const g1 = gradeFor(r.mode1);
            const g2 = gradeFor(r.mode2);
            const variance = Math.abs(r.mode1 - r.mode2);
            return [
              <Addr key="d">{r.did}</Addr>,
              r.operator,
              <Mono key="m1">{r.mode1}</Mono>,
              <Pill key="g1" tone={gradeTone(g1.grade)}>{g1.grade}</Pill>,
              <Mono key="m2">{r.mode2}</Mono>,
              <Pill key="g2" tone={gradeTone(g2.grade)}>{g2.grade}</Pill>,
              <Mono key="v">{variance} pts</Mono>,
              <Pill key="c" tone={CONSENSUS_TONE[r.consensus]}>{r.consensus.toLowerCase()}</Pill>,
              <Pill key="dec" tone={DECISION_TONE[r.decision]}>{r.decision.replace(/_/g, ' ')}</Pill>,
            ];
          })}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Mode 1 always makes the lending decision. Mode 2 exists to catch what a credit file
          can't: an agent whose on-book profile looks healthy but whose live operational behavior
          — failure rates, budget breaches — has deteriorated.
        </p>
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
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            When Mode 2 has not yet settled, consensus reports MEDIUM and Mode 1 stands alone as
            authoritative.
          </p>
        </Panel>

        <Panel title="On-Chain Settlement" label="Mode 2 scores settle for external verification" ink>
          <DataTable
            columns={['Agent', 'Tx', 'Block', 'Chain', 'Settled']}
            rows={SETTLEMENTS.map((s) => [
              <Addr key="d">{s.did}</Addr>,
              <Mono key="t">{s.txHash}</Mono>,
              <Mono key="b">{s.block.toLocaleString('en-US')}</Mono>,
              s.chain,
              <Mono key="at">{s.settledAt}</Mono>,
            ])}
          />
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            Settled Mode 2 scores are readable by any external protocol — the bureau's audit trail
            without exposing the underlying credit file. Settlement runs on a schedule; the FICO
            file never leaves FORGE.
          </p>
        </Panel>
      </Grid2>

      <Panel title="Inquiry Economics" label="priced like a traditional bureau">
        <ol style={{ listStyle: 'none' }}>
          {[
            [`$${feeUsd.toFixed(2)}`, 'Per inquiry', 'every score, dual-score or verification pull is metered — no platform fee'],
            ['~14,600', 'Monthly inquiries', 'across lender pulls and framework-integration gate checks'],
            ['25%', 'Data-contributor share', 'operators feeding outcome data back earn query credits against their own pulls'],
          ].map(([v, item, desc]) => (
            <li key={item} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
              <span className="mono" style={{ minWidth: 64 }}>{v}</span>
              <span style={{ fontWeight: 500, minWidth: 170 }}>{item}</span>
              <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}

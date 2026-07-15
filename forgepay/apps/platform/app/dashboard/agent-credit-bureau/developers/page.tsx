'use client';

import {
  PageHeader,
  Panel,
  Pill,
  DataTable,
  Grid2,
  Mono,
} from '@/components/forge/ui';
import { INQUIRY_FEE_USD } from '@/lib/credit-grade';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau — Developers.
   Endpoints, per-inquiry pricing, framework integrations and the
   data-contributor program.
   ──────────────────────────────────────────────────────────────── */

const SNIPPET = `import { ForgeScoreGate } from "@forge/langgraph";

const gate = new ForgeScoreGate({
  bureauUrl: "https://bureau.forgepay.io",
  apiKey: process.env.FORGE_API_KEY,
  minimumScore: 650,          // block agents below BB
});

graph.addNode("score_check", gate.checkNode());`;

export default function BureauDevelopers() {
  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau / Developers"
        title={
          <>
            The bureau, <em>inside your stack</em>
          </>
        }
        lede={`Every pull is a metered $${INQUIRY_FEE_USD.toFixed(2)} inquiry — no platform fee. Gate agent actions in LangGraph, delegate by grade in CrewAI, or branch n8n workflows on a score.`}
      />

      <Grid2>
        <Panel title="Score-Gated Tools" label="@forge/langgraph" ink>
          <pre className="mono" style={{ fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{SNIPPET}</pre>
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            The gate pulls the score before any tool executes and records the outcome after — the
            agent's next score reflects what it just did.
          </p>
        </Panel>

        <Panel title="Framework Integrations" label="one metered inquiry per gate check">
          <ol style={{ listStyle: 'none' }}>
            {[
              ['@forge/langgraph', 'Score-gated tools', 'checkNode() blocks tool execution below threshold; outcomes recorded back'],
              ['@forge/crewai', 'Trust delegation', 'routes tasks by grade tier — 800+ high-value, 650+ standard, 450+ low-value'],
              ['@forge/n8n', 'No-code nodes', 'Score Check, Verify Agent, Record Outcome — branch on grade with an IF node'],
            ].map(([pkg, use, desc]) => (
              <li key={pkg} style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
                <span className="mono" style={{ minWidth: 140 }}>{pkg}</span>
                <span style={{ fontWeight: 500, minWidth: 118 }}>{use}</span>
                <span style={{ color: 'var(--steel)', fontSize: 13.5 }}>{desc}</span>
              </li>
            ))}
          </ol>
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            The integrations are how inquiry volume compounds — one agent pipeline can pull hundreds
            of scores a day.
          </p>
        </Panel>
      </Grid2>

      <Panel title="API Reference" label="agent-credit-bureau · port 3018" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Method', 'Endpoint', 'What it returns', 'Metered']}
          rows={[
            [<Mono key="m">GET</Mono>, <Mono key="e">/v1/agents/:id/score</Mono>, 'Score, AAA–D grade, tier, top factors', <Pill key="p" tone="accent">$2.80</Pill>],
            [<Mono key="m">GET</Mono>, <Mono key="e">/v1/agents/:id/dual-score</Mono>, 'Mode 1 + Mode 2 with consensus analysis', <Pill key="p" tone="accent">$2.80</Pill>],
            [<Mono key="m">POST</Mono>, <Mono key="e">/v1/agents/:id/verify</Mono>, '8-check verification incl. sanctions', <Pill key="p" tone="accent">$2.80</Pill>],
            [<Mono key="m">POST</Mono>, <Mono key="e">/v1/reports</Mono>, 'Full lender report, consent-gated, 90-day expiry', <Pill key="p" tone="accent">$2.80</Pill>],
            [<Mono key="m">GET</Mono>, <Mono key="e">/v1/grade-scale</Mono>, 'The published AAA–D rating scale', <Pill key="p" tone="ok">free</Pill>],
            [<Mono key="m">POST</Mono>, <Mono key="e">/v1/agents/:id/events</Mono>, 'Record an outcome onto the file', <Pill key="p" tone="ok">free</Pill>],
            [<Mono key="m">POST</Mono>, <Mono key="e">/v1/reports/:id/zk</Mono>, 'ZK proof: score_above, no_default, debt_under', <Pill key="p" tone="accent">$2.80</Pill>],
          ]}
        />
      </Panel>

      <Panel title="Data Contributor Program" label="feed the file, earn query credits">
        <DataTable
          columns={['Contributor type', 'What they furnish', 'Credit earned']}
          rows={[
            ['DeFi protocol', 'Repayment and liquidation events', <Mono key="c">0.5 queries / record</Mono>],
            ['CeFi lender', 'Line openings, delinquencies, defaults', <Mono key="c">0.5 queries / record</Mono>],
            ['SaaS platform', 'Subscription payment behavior', <Mono key="c">0.5 queries / record</Mono>],
            ['Bank', 'Verified settlement history', <Mono key="c">0.5 queries / record</Mono>],
          ]}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Contributors start with 5,000 queries; capacity grows with every record furnished — the
          bureau gets richer, the contributor's pulls get cheaper.
        </p>
      </Panel>
    </>
  );
}

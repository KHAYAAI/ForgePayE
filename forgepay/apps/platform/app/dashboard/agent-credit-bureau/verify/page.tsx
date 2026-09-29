'use client';

import { useState } from 'react';
import {
  PageHeader,
  Panel,
  Pill,
  DataTable,
  Grid2,
  LivePill,
  Mono,
  Addr,
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';
import { GRADE_SCALE, gradeTone } from '@/lib/credit-grade';

interface AgentOption {
  agentId: string;
  did: string;
}

const EMPTY_AGENTS: { agents: AgentOption[] } = { agents: [] };

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau — Verify.
   The verification portal: run the 8-check verify against any
   agent (POST /v1/agents/:id/verify) and the published AAA–D
   rating scale (GET /v1/grade-scale). No canned results — a failed
   or unreachable verify call renders as a real error, never a
   fabricated check-run standing in for one that didn't happen.
   ──────────────────────────────────────────────────────────────── */

type CheckRun = {
  status: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'SUSPICIOUS';
  checksPassed: number;
  checks: Array<{ check: string; passed: boolean; detail: string }>;
};

const VERIFY_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  VERIFIED: 'ok',
  PARTIALLY_VERIFIED: 'accent',
  UNVERIFIED: 'warn',
  SUSPICIOUS: 'danger',
};

export default function BureauVerify() {
  const { data: agentsData, live: agentsLive } = useForge<{ agents: AgentOption[] }>('bureau', EMPTY_AGENTS);
  const agents = agentsData.agents ?? [];

  const [agentId, setAgentId] = useState<string | null>(null);
  const [ran, setRan] = useState<string | null>(null);
  const [liveResult, setLiveResult] = useState<CheckRun | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The select has no controlled default once agents can legitimately be
  // empty — fall back to the first loaded agent only once, not on every render.
  const effectiveAgentId = agentId ?? agents[0]?.agentId ?? null;
  const did = agents.find((a) => a.agentId === effectiveAgentId)?.did ?? effectiveAgentId;
  const result = liveResult;

  const runVerify = async () => {
    if (!effectiveAgentId) return;
    setRunning(true);
    setRan(did);
    setLiveResult(null);
    setError(null);
    const res = await fetch('/api/forge/bureau-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: effectiveAgentId }),
    }).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    if (body?.live && body.data) {
      setLiveResult(body.data as CheckRun);
    } else {
      setError('Could not run verification — the bureau is unreachable right now. Try again shortly.');
    }
    setRunning(false);
  };

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau / Verify"
        title={
          <>
            Eight checks, <em>one verdict</em>
          </>
        }
        lede="Verification runs identity, history, sanctions and score checks in one $2.80 pull. Any sanctions exposure returns SUSPICIOUS regardless of the other seven."
        actions={<LivePill live={agentsLive} />}
      />

      <Panel title="Run a Verification" label="POST /v1/agents/:id/verify · metered at $2.80" style={{ marginBottom: 20 }}>
        {agents.length === 0 ? (
          <p className="lede" style={{ fontSize: 13 }}>
            No agents in the register yet — verification runs against an agent once it has a credit profile.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={effectiveAgentId ?? ''}
              onChange={(e) => setAgentId(e.target.value)}
              style={{
                border: '1px solid var(--hair)',
                background: 'var(--paper)',
                padding: '10px 12px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                color: 'var(--ink)',
                minWidth: 260,
              }}
            >
              {agents.map((a) => (
                <option key={a.agentId} value={a.agentId}>{a.did}</option>
              ))}
            </select>
            <button className="btn-ghost btn-sm" onClick={runVerify} disabled={running}>
              {running ? 'Running…' : 'Run 8-check verify → $2.80'}
            </button>
            {result && ran && (
              <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', marginLeft: 8 }}>
                <Pill tone={VERIFY_TONE[result.status]}>{result.status.replace(/_/g, ' ').toLowerCase()}</Pill>
                <Mono>{result.checksPassed} / 8 checks</Mono>
              </span>
            )}
            {error && (
              <span style={{ marginLeft: 8 }}><Pill tone="danger">{error}</Pill></span>
            )}
          </div>
        )}
      </Panel>

      <Grid2>
        <Panel
          title={ran ? `Result — ${ran}` : 'Result'}
          label="each check with its evidence"
          ink
        >
          {result ? (
            <ol style={{ listStyle: 'none' }}>
              {result.checks.map((c) => (
                <li key={c.check} style={{ display: 'flex', gap: 14, padding: '9px 0', borderBottom: '1px solid rgba(244,242,238,0.14)', alignItems: 'baseline' }}>
                  <span className="mono" style={{ minWidth: 16 }}>{c.passed ? '✓' : '✗'}</span>
                  <span className="mono" style={{ minWidth: 170 }}>{c.check}</span>
                  <span style={{ fontSize: 13, opacity: 0.75 }}>{c.detail}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="lede">{agents.length === 0 ? 'No agents available to verify yet.' : 'Select an agent and run the verification.'}</p>
          )}
          <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
            8 of 8 → <strong>VERIFIED</strong> · 6–7 → <strong>PARTIALLY_VERIFIED</strong> · below 6
            → <strong>UNVERIFIED</strong> · any sanctions exposure → <strong>SUSPICIOUS</strong>.
          </p>
        </Panel>

        <Panel title="Credit Rating Scale" label="published AAA–D grades · GET /v1/grade-scale">
          <DataTable
            columns={['Grade', 'Score', 'Risk level', 'What it means']}
            rows={GRADE_SCALE.map((b) => [
              <Pill key="g" tone={gradeTone(b.grade)}>{b.grade}</Pill>,
              <Mono key="r">{b.min}–{b.max}</Mono>,
              b.riskLevel,
              b.meaning,
            ])}
          />
        </Panel>
      </Grid2>
    </>
  );
}

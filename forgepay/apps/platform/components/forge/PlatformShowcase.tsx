'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/* ────────────────────────────────────────────────────────────────
   PlatformShowcase — a self-playing walkthrough of FORGE.

   Eight timed scenes, drawn from the console's own design tokens. Every
   claim matches what the code does today (see docs/PLATFORM_REPORT and
   docs/LAUNCH_READINESS): the Credit Bureau is the product opening first;
   custody is for design partners; wallet is testnet; payments and
   treasury wait for licensing. The UI fragments use the field names and
   values the real services return (dual-score with no Mode 2, lender
   report routed to manual review, settlement awaiting execution).

   Props:
     autoPlay  start on mount (default true)
     loop      restart at the end (default true)
     capture   hide controls, for recording to video (/showcase?capture=1)
   Respects prefers-reduced-motion: shows scenes without motion and does
   not auto-advance.
   ──────────────────────────────────────────────────────────────── */

type Status = 'opening first' | 'design partners' | 'testnet' | 'after licensing' | 'in use internally';

interface Scene {
  id: string;
  eyebrow: string;
  title: ReactNode;
  body: string;
  status?: Status;
  ms: number;
  visual: (t: number) => ReactNode;
}

const C = {
  ink: '#0A0A0A',
  ink2: '#141414',
  paper: '#F4F2EE',
  steel: '#9A948A',
  hair: '#2A2A2A',
  accent: '#00d1ff',
  ok: '#3fbf7f',
  warn: '#e0a23a',
};

const mono: CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

/** 0→1 over [a, b] of the scene's own timeline, eased. */
function seg(t: number, a: number, b: number): number {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return 1 - Math.pow(1 - x, 3);
}

function rise(t: number, a: number, b: number, dist = 18): CSSProperties {
  const p = seg(t, a, b);
  return { opacity: p, transform: `translateY(${(1 - p) * dist}px)` };
}

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: C.ink2, border: `1px solid ${C.hair}`, borderRadius: 10, padding: '16px 18px', ...style }}>
      {children}
    </div>
  );
}

function Tag({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'ok' | 'warn' | 'steel' }) {
  const color = tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : tone === 'steel' ? C.steel : C.accent;
  return (
    <span style={{ ...mono, fontSize: 11, letterSpacing: 0.4, color, border: `1px solid ${color}`, borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function Row({ k, v, t, at, tone }: { k: string; v: ReactNode; t: number; at: number; tone?: 'ok' | 'warn' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: `1px solid ${C.hair}`, ...rise(t, at, at + 0.12, 8) }}>
      <span style={{ ...mono, fontSize: 12, color: C.steel }}>{k}</span>
      <span style={{ ...mono, fontSize: 12.5, color: tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : C.paper }}>{v}</span>
    </div>
  );
}

const SCENES: Scene[] = [
  {
    id: 'intro',
    eyebrow: 'FORGE',
    title: <>Financial infrastructure <em style={{ color: C.accent, fontStyle: 'italic' }}>for AI agents</em></>,
    body: 'Credit files for agents, threshold custody, wallets, payments and treasury, built in South Africa, opening one product at a time.',
    ms: 5200,
    visual: (t) => (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {['Credit Bureau', 'Custody', 'Wallet', 'Payments', 'Treasury', 'Compliance'].map((name, i) => (
          <Card key={name} style={{ ...rise(t, 0.1 + i * 0.07, 0.3 + i * 0.07), padding: '18px 16px' }}>
            <div style={{ ...mono, fontSize: 11, color: C.steel }}>{String(i + 1).padStart(2, '0')}</div>
            <div style={{ fontSize: 17, marginTop: 8 }}>{name}</div>
          </Card>
        ))}
      </div>
    ),
  },
  {
    id: 'bureau',
    eyebrow: '01 · Credit Bureau',
    title: <>A credit file for <em style={{ color: C.accent, fontStyle: 'italic' }}>every agent</em></>,
    body: 'Lenders furnish repayment records; the bureau keeps a file per agent, scores it with a published formula, and handles disputes on a 30-day clock. Each workspace sees only its own agents.',
    status: 'opening first',
    ms: 7600,
    visual: (t) => (
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, ...rise(t, 0.05, 0.2) }}>
          <span style={{ ...mono, fontSize: 12, color: C.steel }}>POST /v1/agents/:id/profile</span>
          <Tag tone="ok">201 registered</Tag>
        </div>
        <Row t={t} at={0.18} k="did" v="did:forge:agent_demo" />
        <Row t={t} at={0.24} k="managedBy" v="your workspace" />
        <Row t={t} at={0.32} k="Mode 1 score" v={<span style={{ fontSize: 22 * seg(t, 0.32, 0.5) + 0.001 }}>{Math.round(300 + 412 * seg(t, 0.32, 0.6))}</span>} />
        <Row t={t} at={0.42} k="Mode 2 (on-chain)" v="— no on-chain data" tone="warn" />
        <Row t={t} at={0.5} k="factor" v="THIN_FILE · no payments reported yet" tone="warn" />
        <Row t={t} at={0.58} k="disputes" v="0 open · 30-day clock" />
      </Card>
    ),
  },
  {
    id: 'report',
    eyebrow: '01 · Lender report',
    title: <>Decisions that <em style={{ color: C.accent, fontStyle: 'italic' }}>show their work</em></>,
    body: 'A paid pull returns the score, reason codes from a published catalogue, data sufficiency and a sanctions screen. Thin files go to manual review, not automatic approval. Billing is prepaid in USDC.',
    status: 'opening first',
    ms: 7200,
    visual: (t) => (
      <div style={{ display: 'grid', gap: 10 }}>
        <Card style={rise(t, 0.05, 0.2)}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ ...mono, fontSize: 12, color: C.steel }}>decision.scoreBasedOutcome</span>
            <span style={{ ...mono, fontSize: 12.5, textDecoration: seg(t, 0.4, 0.5) > 0.5 ? 'line-through' : 'none', color: C.steel }}>approve</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, ...rise(t, 0.42, 0.55, 6) }}>
            <span style={{ ...mono, fontSize: 12, color: C.steel }}>decision.outcome</span>
            <Tag tone="warn">manual_review</Tag>
          </div>
          <div style={{ ...mono, fontSize: 11.5, color: C.steel, marginTop: 10, ...rise(t, 0.55, 0.68, 6) }}>
            INSUFFICIENT_DATA_FOR_AUTOMATED_DECISION
          </div>
        </Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Card style={rise(t, 0.62, 0.76)}>
            <div style={{ ...mono, fontSize: 11, color: C.steel }}>sanctions screen</div>
            <div style={{ marginTop: 6, fontSize: 14 }}>OFAC · EU · UN · UK · ZA TFS</div>
          </Card>
          <Card style={rise(t, 0.7, 0.84)}>
            <div style={{ ...mono, fontSize: 11, color: C.steel }}>billing</div>
            <div style={{ marginTop: 6, fontSize: 14 }}>Prepaid · USDC on Base</div>
          </Card>
        </div>
      </div>
    ),
  },
  {
    id: 'custody',
    eyebrow: '02 · Custody',
    title: <>Two of three must <em style={{ color: C.accent, fontStyle: 'italic' }}>sign</em></>,
    body: 'A threshold key per workspace, approvals signed by each person, limits on every node, encrypted backups. Built and tested on testnet; opening to design partners after an independent review.',
    status: 'design partners',
    ms: 7000,
    visual: (t) => {
      const signers = ['Signer A', 'Signer B', 'Signer C'];
      const signed = [seg(t, 0.25, 0.4) > 0.5, seg(t, 0.45, 0.6) > 0.5, false];
      return (
        <Card>
          <div style={{ ...mono, fontSize: 12, color: C.steel, marginBottom: 12, ...rise(t, 0.05, 0.18) }}>transfer · 0.5 ETH · sepolia</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {signers.map((s, i) => (
              <div key={s} style={{ border: `1px solid ${signed[i] ? C.ok : C.hair}`, borderRadius: 8, padding: 14, textAlign: 'center', transition: 'border-color .3s', ...rise(t, 0.1 + i * 0.05, 0.25 + i * 0.05) }}>
                <div style={{ fontSize: 14 }}>{s}</div>
                <div style={{ ...mono, fontSize: 11, marginTop: 6, color: signed[i] ? C.ok : C.steel }}>{signed[i] ? 'signed' : 'waiting'}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, ...rise(t, 0.62, 0.75, 6) }}>
            <span style={{ ...mono, fontSize: 12, color: C.steel }}>quorum 2 / 3</span>
            <Tag tone="ok">threshold signature produced</Tag>
          </div>
        </Card>
      );
    },
  },
  {
    id: 'wallet',
    eyebrow: '03 · Wallet',
    title: <>One key per wallet, <em style={{ color: C.accent, fontStyle: 'italic' }}>wrapped by KMS</em></>,
    body: 'Every private key is encrypted under its own data key, and every unwrap is a logged AWS KMS call bound to its owner. No master key opens everyone. Testnet only for now.',
    status: 'testnet',
    ms: 6600,
    visual: (t) => (
      <div style={{ display: 'grid', gap: 10 }}>
        {[
          ['private key', 'AES-256-GCM under a fresh data key'],
          ['data key', 'wrapped by AWS KMS · context: owner'],
          ['unwrap', 'one logged KMS call · CloudTrail'],
          ['chains', 'Sepolia · Amoy · Base Sepolia · Solana devnet'],
        ].map(([k, v], i) => (
          <Card key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 18px', ...rise(t, 0.08 + i * 0.12, 0.25 + i * 0.12) }}>
            <span style={{ ...mono, fontSize: 12, color: C.steel }}>{k}</span>
            <span style={{ fontSize: 14 }}>{v}</span>
          </Card>
        ))}
      </div>
    ),
  },
  {
    id: 'payments',
    eyebrow: '04 · Payments & Treasury',
    title: <>Money moves <em style={{ color: C.accent, fontStyle: 'italic' }}>only when it should</em></>,
    body: 'Card checkout runs on Hyperswitch with renewals billed by Kill Bill. Treasury consolidates linked bank accounts and nets intercompany flows; settlements are recorded for an operator to execute. Both open after licensing.',
    status: 'after licensing',
    ms: 7400,
    visual: (t) => (
      <div style={{ display: 'grid', gap: 10 }}>
        <Card style={rise(t, 0.05, 0.2)}>
          <div style={{ ...mono, fontSize: 11, color: C.steel }}>Kill Bill · payments-standard</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Tag tone="steel">month 1 · $0 (paid at checkout)</Tag>
            <Tag>from month 2 · $28 / month</Tag>
          </div>
        </Card>
        <Card style={rise(t, 0.35, 0.5)}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ ...mono, fontSize: 12, color: C.steel }}>POST /v1/transfers/wire</span>
            <Tag tone="warn">202 awaiting_execution</Tag>
          </div>
          <div style={{ ...mono, fontSize: 11.5, color: C.steel, marginTop: 10 }}>executed: false · no bank reference invented</div>
        </Card>
      </div>
    ),
  },
  {
    id: 'compliance',
    eyebrow: '05 · Compliance',
    title: <>Screens that <em style={{ color: C.accent, fontStyle: 'italic' }}>fail closed</em></>,
    body: 'Every sanctions list in use must be loaded and fresh, or screening answers "error", never "clear". Suspicious and cash-threshold reports are drafted in goAML format for a compliance officer, who files them with the FIC.',
    status: 'in use internally',
    ms: 7000,
    visual: (t) => (
      <Card>
        {[
          ['OFAC_SDN', 'loaded · 3h'],
          ['EU_CONSOLIDATED', 'loaded · 5h'],
          ['UN_CONSOLIDATED', 'loaded · 2h'],
          ['ZA_TFS', seg(t, 0.55, 0.65) > 0.5 ? 'loaded · 1h' : 'not loaded'],
        ].map(([k, v], i) => (
          <Row key={k} t={t} at={0.08 + i * 0.1} k={k} v={v} tone={v.startsWith('not') ? 'warn' : 'ok'} />
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, ...rise(t, 0.5, 0.6, 6) }}>
          <span style={{ ...mono, fontSize: 12, color: C.steel }}>screen result</span>
          {seg(t, 0.55, 0.65) > 0.5 ? <Tag tone="ok">clear</Tag> : <Tag tone="warn">error · list not loaded</Tag>}
        </div>
      </Card>
    ),
  },
  {
    id: 'status',
    eyebrow: 'Where things stand',
    title: <>Opening <em style={{ color: C.accent, fontStyle: 'italic' }}>one product at a time</em></>,
    body: 'The Credit Bureau opens first, to early-access design partners. Everything else follows its own review, licensing and launch.',
    ms: 6800,
    visual: (t) => (
      <Card>
        {([
          ['Credit Bureau', 'early access', 'ok'],
          ['Custody', 'design partners, after review', 'warn'],
          ['Wallet', 'testnet', 'warn'],
          ['Payments', 'after licensing', 'warn'],
          ['Treasury', 'after licensing', 'warn'],
        ] as const).map(([k, v, tone], i) => (
          <Row key={k} t={t} at={0.08 + i * 0.09} k={k} v={v} tone={tone} />
        ))}
        <div style={{ marginTop: 16, ...rise(t, 0.6, 0.72, 6) }}>
          <span style={{ background: C.accent, color: C.ink, borderRadius: 999, padding: '9px 16px', fontSize: 14, fontWeight: 600 }}>
            Request early access →
          </span>
        </div>
      </Card>
    ),
  },
];

const TOTAL_MS = SCENES.reduce((s, x) => s + x.ms, 0);

export function PlatformShowcase({ autoPlay = true, loop = true, capture = false }: { autoPlay?: boolean; loop?: boolean; capture?: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [reduced, setReduced] = useState(false);
  const last = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq?.matches && !capture) {
      setReduced(true);
      setPlaying(false);
    }
  }, [capture]);

  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      if (last.current !== null) {
        const dt = now - last.current;
        setElapsed((e) => {
          const next = e + dt;
          if (next >= TOTAL_MS) {
            if (loop) return 0;
            setPlaying(false);
            return TOTAL_MS - 1;
          }
          return next;
        });
      }
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop]);

  // Which scene, and how far through it.
  let acc = 0;
  let index = 0;
  for (let i = 0; i < SCENES.length; i++) {
    if (elapsed < acc + SCENES[i]!.ms) { index = i; break; }
    acc += SCENES[i]!.ms;
    index = i;
  }
  const scene = SCENES[index]!;
  const t = reduced ? 1 : Math.min(1, (elapsed - acc) / scene.ms);
  const fade = reduced ? 1 : Math.min(seg(t, 0, 0.08), 1 - seg(t, 0.94, 1));

  const goTo = useCallback((i: number) => {
    setElapsed(SCENES.slice(0, i).reduce((s, x) => s + x.ms, 0) + 1);
  }, []);

  return (
    <figure
      aria-label="FORGE platform walkthrough"
      style={{
        position: 'relative', margin: 0, background: C.ink, color: C.paper, borderRadius: capture ? 0 : 16,
        overflow: 'hidden', aspectRatio: '16 / 9', width: '100%', fontFamily: "'Inter Tight', -apple-system, sans-serif",
      }}
    >
      {/* accent glow */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: `radial-gradient(60% 50% at ${20 + index * 8}% 0%, rgba(0,209,255,0.14), transparent 70%)`, transition: 'background 1.2s' }} />

      <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4%', padding: '6% 6% 9%', alignItems: 'center', opacity: fade }}>
        <div>
          <div style={{ ...mono, fontSize: 'clamp(10px, 1.1vw, 13px)', letterSpacing: 1.2, textTransform: 'uppercase', color: C.accent, ...rise(t, 0.02, 0.14) }}>
            {scene.eyebrow}
          </div>
          <h2 style={{ fontSize: 'clamp(22px, 3.4vw, 46px)', lineHeight: 1.08, fontWeight: 400, letterSpacing: -1, margin: '14px 0 16px', ...rise(t, 0.05, 0.2) }}>
            {scene.title}
          </h2>
          <p style={{ fontSize: 'clamp(12px, 1.25vw, 16px)', lineHeight: 1.55, color: '#C9C3B7', maxWidth: 520, ...rise(t, 0.1, 0.26) }}>
            {scene.body}
          </p>
          {scene.status && (
            <div style={{ marginTop: 18, ...rise(t, 0.16, 0.3) }}>
              <Tag tone={scene.status === 'opening first' ? 'ok' : scene.status === 'in use internally' ? 'accent' : 'warn'}>
                status · {scene.status}
              </Tag>
            </div>
          )}
        </div>
        <div style={{ fontSize: 14 }}>{scene.visual(t)}</div>
      </div>

      {/* progress */}
      <div style={{ position: 'absolute', left: '6%', right: '6%', bottom: '5%', display: 'flex', gap: 6, alignItems: 'center' }}>
        {SCENES.map((s, i) => {
          const fill = i < index ? 1 : i === index ? t : 0;
          return (
            <button
              key={s.id}
              type="button"
              aria-label={`Go to ${s.eyebrow}`}
              onClick={() => goTo(i)}
              disabled={capture}
              style={{ flex: s.ms, height: 3, border: 0, padding: 0, background: C.hair, borderRadius: 2, cursor: capture ? 'default' : 'pointer', position: 'relative', overflow: 'hidden' }}
            >
              <span style={{ position: 'absolute', inset: 0, width: `${fill * 100}%`, background: C.accent }} />
            </button>
          );
        })}
        {!capture && (
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'Pause' : 'Play'}
            style={{ ...mono, marginLeft: 10, fontSize: 11, color: C.paper, background: 'transparent', border: `1px solid ${C.hair}`, borderRadius: 999, padding: '4px 10px', cursor: 'pointer' }}
          >
            {playing ? 'pause' : 'play'}
          </button>
        )}
      </div>
    </figure>
  );
}

export const SHOWCASE_DURATION_MS = TOTAL_MS;

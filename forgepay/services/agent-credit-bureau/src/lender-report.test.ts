/**
 * Lender report — the underwriting packet issued to third-party lenders.
 *
 * The invariants worth guarding here are the ones that make the report usable
 * by a human and an autonomous underwriter at the same time:
 *
 *  - every code the scorer can emit resolves in the published catalog, so an
 *    agent never meets a code it cannot interpret;
 *  - the prose is derived from the structured fields, so the two views cannot
 *    disagree;
 *  - a compliance or data-quality problem never launders itself into a lawful
 *    adverse-action reason;
 *  - a sufficiency downgrade is always visible next to what the score alone
 *    said, rather than silently replacing it.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';
import {
  buildLenderReport, summariseActivity, assessDataSufficiency,
  renderLenderReportMarkdown, reasonCodeDefinition, REASON_CODE_CATALOG,
  LENDER_REPORT_SCHEMA_VERSION,
} from './lender-report';
import { computeScore } from './scorer';
import type { AgentCreditProfile, CreditEvent } from './types';
import type { SanctionsResult } from './verify';

const ADMIN = 'dev-bureau-admin-key';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-06-01T00:00:00.000Z');

const bearer = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });

function event(over: Partial<CreditEvent> = {}): CreditEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    agentId: 'agent_lr',
    eventType: 'payment_on_time',
    amount: 1_000,
    description: 'on-time payment',
    timestamp: new Date(NOW - 10 * DAY).toISOString(),
    contributorId: 'contrib_aave',
    ...over,
  };
}

function profile(over: Partial<AgentCreditProfile> = {}): AgentCreditProfile {
  const base: AgentCreditProfile = {
    agentId: 'agent_lr',
    did: 'did:forge:agent_lr',
    operatorEntityId: 'EIN-22-2222222',
    operatorEntityType: 'llc',
    currentScore: 0,
    tier: 'PRIME',
    scoreFactors: [],
    creditHistory: Array.from({ length: 14 }, (_, i) =>
      event({ timestamp: new Date(NOW - (i * 12 + 5) * DAY).toISOString() }),
    ),
    totalDebt: 5_000,
    totalCreditLimit: 50_000,
    utilizationRate: 0.1,
    paymentHistoryRate: 1,
    delinquencies: [],
    hardInquiries: [],
    createdAt: new Date(NOW - 400 * DAY).toISOString(),
    lastUpdatedAt: new Date(NOW).toISOString(),
    ...over,
  };
  // Route the score through the real scorer so the report never tests against
  // a hand-written score the scorer would not produce.
  const { score, factors } = computeScore(base);
  base.currentScore = score;
  base.scoreFactors = factors;
  return base;
}

function clearSanctions(over: Partial<SanctionsResult> = {}): SanctionsResult {
  return {
    agentId: 'agent_lr',
    clear: true,
    hits: 0,
    frozen: false,
    checked: ['local', 'address', 'entity'],
    detail: 'Clear on all 3 check(s) performed (local, address, entity).',
    screenedAt: new Date(NOW).toISOString(),
    ...over,
  };
}

function build(p: AgentCreditProfile, sanctions = clearSanctions()) {
  return buildLenderReport({
    reportId: 'lr_test',
    profile: p,
    requestorId: 'mfi_kenya_01',
    requestorName: 'Nairobi Microfinance',
    purpose: 'credit_application',
    sanctions,
    furnisherNames: new Map([['contrib_aave', 'Aave']]),
    nowMs: NOW,
  });
}

// ── Vocabulary ────────────────────────────────────────────────────────────────

describe('reason code catalog', () => {
  it('resolves every factor code the scorer can emit', () => {
    // Extracted from scorer.ts rather than hand-listed: a factor added there
    // without a catalog entry must fail this test, not ship an unresolvable
    // code to an autonomous underwriter.
    const scorerCodes = [
      'RECENT_DEFAULT', 'LATE_PAYMENTS', 'STRONG_PAYMENT_HISTORY',
      'HIGH_UTILIZATION', 'LOW_UTILIZATION',
      'SHORT_CREDIT_HISTORY', 'ESTABLISHED_HISTORY',
      'DIVERSE_CREDIT_MIX', 'LIMITED_CREDIT_MIX',
      'HIGH_INQUIRY_VELOCITY',
    ];
    for (const code of scorerCodes) {
      expect(reasonCodeDefinition(code), `${code} missing from catalog`).toBeDefined();
    }
  });

  it('has no duplicate codes', () => {
    const codes = REASON_CODE_CATALOG.map(d => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('never marks a compliance code as adverse-action eligible', () => {
    // An incomplete sanctions screen is the bureau's data problem, not a
    // lawful reason to decline a borrower.
    for (const def of REASON_CODE_CATALOG.filter(d => d.source === 'compliance')) {
      expect(def.adverseAction, `${def.code} must not be adverse-action eligible`).toBe(false);
    }
  });

  it('never marks a data-sufficiency code as adverse-action eligible', () => {
    for (const def of REASON_CODE_CATALOG.filter(d => d.source === 'data_sufficiency')) {
      expect(def.adverseAction, `${def.code} must not be adverse-action eligible`).toBe(false);
    }
  });
});

// ── Activity ──────────────────────────────────────────────────────────────────

describe('summariseActivity', () => {
  it('buckets events into 30/90/365-day windows', () => {
    const p = profile({
      creditHistory: [
        event({ timestamp: new Date(NOW - 5 * DAY).toISOString(), amount: 100 }),
        event({ timestamp: new Date(NOW - 60 * DAY).toISOString(), amount: 200 }),
        event({ timestamp: new Date(NOW - 200 * DAY).toISOString(), amount: 400 }),
        event({ timestamp: new Date(NOW - 800 * DAY).toISOString(), amount: 800 }),
      ],
    });
    const a = summariseActivity(p, NOW);
    expect(a.windows.last30d.events).toBe(1);
    expect(a.windows.last90d.events).toBe(2);
    expect(a.windows.last365d.events).toBe(3);
    expect(a.windows.allTime.events).toBe(4);
    expect(a.windows.last30d.volumeUsd).toBe(100);
    expect(a.windows.allTime.volumeUsd).toBe(1500);
  });

  it('counts payment outcomes by type', () => {
    const p = profile({
      creditHistory: [
        event({ eventType: 'payment_on_time' }),
        event({ eventType: 'payment_on_time' }),
        event({ eventType: 'payment_late_30' }),
        event({ eventType: 'payment_late_90' }),
        event({ eventType: 'default' }),
        event({ eventType: 'credit_opened' }),
      ],
    });
    const a = summariseActivity(p, NOW);
    expect(a.paymentBehaviour.onTime).toBe(2);
    expect(a.paymentBehaviour.late30).toBe(1);
    expect(a.paymentBehaviour.late90).toBe(1);
    expect(a.paymentBehaviour.defaults).toBe(1);
    expect(a.paymentBehaviour.onTimeRatePct).toBe(50); // 2 of 4 payments
    expect(a.windows.allTime.newCreditLines).toBe(1);
  });

  it('reports dormant when nothing has happened for over 180 days', () => {
    const p = profile({
      creditHistory: [event({ timestamp: new Date(NOW - 300 * DAY).toISOString() })],
    });
    expect(summariseActivity(p, NOW).trend).toBe('dormant');
  });

  it('declines to claim a trend from fewer than three recent events', () => {
    const p = profile({
      creditHistory: [
        event({ timestamp: new Date(NOW - 10 * DAY).toISOString() }),
        event({ timestamp: new Date(NOW - 20 * DAY).toISOString() }),
      ],
    });
    expect(summariseActivity(p, NOW).trend).toBe('insufficient_data');
  });

  it('detects an increasing trend', () => {
    const p = profile({
      creditHistory: [
        ...Array.from({ length: 6 }, () => event({ timestamp: new Date(NOW - 10 * DAY).toISOString() })),
        event({ timestamp: new Date(NOW - 120 * DAY).toISOString() }),
      ],
    });
    expect(summariseActivity(p, NOW).trend).toBe('increasing');
  });

  it('reports null on-time rate when no payments exist at all', () => {
    const p = profile({ creditHistory: [event({ eventType: 'credit_opened' })] });
    expect(summariseActivity(p, NOW).paymentBehaviour.onTimeRatePct).toBeNull();
  });
});

// ── Sufficiency ───────────────────────────────────────────────────────────────

describe('assessDataSufficiency', () => {
  it('calls a well-populated multi-furnisher file thick', () => {
    const p = profile({
      creditHistory: Array.from({ length: 20 }, (_, i) =>
        event({
          timestamp: new Date(NOW - (i * 10 + 5) * DAY).toISOString(),
          contributorId: i % 2 === 0 ? 'contrib_aave' : 'contrib_compound',
        }),
      ),
    });
    const s = assessDataSufficiency(p, summariseActivity(p, NOW));
    expect(s.level).toBe('thick_file');
    expect(s.furnisherCount).toBe(2);
    expect(s.confidence).toBe('high');
  });

  it('flags a single-furnisher file as uncorroborated even when thick', () => {
    const p = profile({
      creditHistory: Array.from({ length: 20 }, (_, i) =>
        event({ timestamp: new Date(NOW - (i * 10 + 5) * DAY).toISOString() }),
      ),
    });
    const s = assessDataSufficiency(p, summariseActivity(p, NOW));
    expect(s.furnisherCount).toBe(1);
    expect(s.confidence).not.toBe('high');
    expect(s.caveats.join(' ')).toMatch(/single furnisher/i);
  });

  it('calls a two-event file insufficient', () => {
    const p = profile({ creditHistory: [event(), event()] });
    const s = assessDataSufficiency(p, summariseActivity(p, NOW));
    expect(s.level).toBe('insufficient');
    expect(s.confidence).toBe('low');
  });

  it('notes records with no furnisher attribution', () => {
    const p = profile({
      creditHistory: Array.from({ length: 5 }, () => event({ contributorId: undefined })),
    });
    const s = assessDataSufficiency(p, summariseActivity(p, NOW));
    expect(s.furnisherCount).toBe(0);
    expect(s.caveats.join(' ')).toMatch(/provenance cannot be checked/i);
  });
});

// ── Decision ──────────────────────────────────────────────────────────────────

describe('buildLenderReport — decision', () => {
  it('carries the score straight from the profile rather than recomputing it', () => {
    const p = profile();
    expect(build(p).decision.score).toBe(p.currentScore);
  });

  it('downgrades an automated approval on an insufficient file, and shows its work', () => {
    const p = profile({ creditHistory: [event()] });
    const r = build(p);
    expect(r.decision.outcome).toBe('manual_review');
    // The point of the pair: the adjustment is auditable, not hidden.
    expect(r.decision.scoreBasedOutcome).not.toBe('manual_review');
    expect(r.decision.adjustmentReason).toMatch(/too little to decide automatically/i);
    expect(r.decision.reasonCodes.map(c => c.code))
      .toContain('INSUFFICIENT_DATA_FOR_AUTOMATED_DECISION');
  });

  it('declines on a real sanctions match regardless of score', () => {
    const p = profile();
    expect(p.currentScore).toBeGreaterThan(700); // would otherwise approve
    const r = build(p, clearSanctions({
      clear: false,
      checked: ['local', 'entity'],
      detail: 'operator entity flagged (confirmed_match, block)',
      entityScreen: {
        checked: true,
        clear: false,
        result: {
          entity_id: 'agent_lr', entity_type: 'business', name: 'X',
          screened_at: new Date(NOW).toISOString(),
          result: 'confirmed_match', matches: [], risk_score: 90,
          recommended_action: 'block',
        },
      },
    }));
    expect(r.decision.outcome).toBe('decline');
    expect(r.decision.reasonCodes.map(c => c.code)).toContain('SANCTIONS_MATCH');
  });

  it('declines — but distinguishes the reason — when screening could not run', () => {
    const r = build(profile(), clearSanctions({
      clear: false,
      checked: ['local', 'entity'],
      detail: 'entity screen unavailable (call_failed)',
      entityScreen: { checked: false, clear: false, reason: 'call_failed' },
    }));
    expect(r.decision.outcome).toBe('decline');
    const codes = r.decision.reasonCodes.map(c => c.code);
    expect(codes).toContain('SANCTIONS_SCREEN_UNAVAILABLE');
    expect(codes).not.toContain('SANCTIONS_MATCH');
    expect(r.decision.adjustmentReason).toMatch(/unknown/i);
  });

  it('never cites a compliance failure as an adverse-action reason', () => {
    const r = build(profile(), clearSanctions({
      clear: false,
      detail: 'entity screen unavailable (call_failed)',
      entityScreen: { checked: false, clear: false, reason: 'call_failed' },
    }));
    expect(r.decision.outcome).toBe('decline');
    expect(r.decision.adverseActionCodes).not.toContain('SANCTIONS_SCREEN_UNAVAILABLE');
    expect(r.decision.adverseActionCodes).not.toContain('SANCTIONS_MATCH');
    for (const code of r.decision.adverseActionCodes) {
      expect(reasonCodeDefinition(code)?.adverseAction).toBe(true);
    }
  });

  it('surfaces open delinquencies as exposure and as a citable reason', () => {
    const p = profile({
      delinquencies: [
        { id: 'd1', creditorId: 'c1', amount: 900, daysLate: 60, openedAt: new Date(NOW - 40 * DAY).toISOString(), status: 'open' },
        { id: 'd2', creditorId: 'c1', amount: 100, daysLate: 30, openedAt: new Date(NOW - 20 * DAY).toISOString(), status: 'resolved' },
      ],
    });
    const r = build(p);
    expect(r.exposure.openDelinquencies).toBe(1);
    expect(r.exposure.worstDelinquencyDaysLate).toBe(60);
    const delinq = r.decision.reasonCodes.find(c => c.code === 'OPEN_DELINQUENCY');
    expect(delinq).toBeDefined();
    expect(delinq!.adverseAction).toBe(true);
  });

  it('computes exposure headroom against the recommended limit', () => {
    const r = build(profile({ totalDebt: 1_000, totalCreditLimit: 10_000, utilizationRate: 0.1 }));
    expect(r.exposure.availableCreditUsd).toBe(9_000);
    expect(r.exposure.utilizationRatePct).toBe(10);
    expect(r.exposure.headroomVsRecommendedUsd)
      .toBe(r.decision.maxRecommendedLimitUsd - 1_000);
  });

  it('attributes records to named furnishers, ranked by volume', () => {
    const p = profile({
      creditHistory: [
        ...Array.from({ length: 3 }, () => event({ contributorId: 'contrib_aave' })),
        ...Array.from({ length: 5 }, () => event({ contributorId: 'contrib_compound' })),
      ],
    });
    const r = build(p);
    expect(r.evidence.furnishers[0]!.contributorId).toBe('contrib_compound');
    expect(r.evidence.furnishers[0]!.recordsContributed).toBe(5);
    // Known ids resolve to display names; unknown ones fall back to the id.
    expect(r.evidence.furnishers.find(f => f.contributorId === 'contrib_aave')!.name).toBe('Aave');
    expect(r.evidence.furnishers.find(f => f.contributorId === 'contrib_compound')!.name)
      .toBe('contrib_compound');
  });

  it('reports which sanctions checks actually ran, not merely that it passed', () => {
    const r = build(profile(), clearSanctions({ checked: ['local'] }));
    expect(r.evidence.compliance.sanctionsChecksPerformed).toEqual(['local']);
  });
});

// ── Narrative ─────────────────────────────────────────────────────────────────

describe('narrative', () => {
  it('states the same outcome and score as the structured decision', () => {
    const r = build(profile());
    expect(r.narrative.headline).toContain(String(r.decision.score));
    expect(r.narrative.headline).toContain(r.decision.grade);
    expect(r.narrative.headline).toContain(r.decision.confidence);
  });

  it('writes an adverse-action notice only when declining', () => {
    expect(build(profile()).narrative.adverseAction).toBeUndefined();

    const declined = build(profile({
      creditHistory: Array.from({ length: 14 }, (_, i) =>
        event({ eventType: 'default', timestamp: new Date(NOW - (i * 12 + 5) * DAY).toISOString() }),
      ),
      paymentHistoryRate: 0.1,
      utilizationRate: 0.95,
      totalDebt: 47_500,
    }));
    expect(declined.decision.outcome).toBe('decline');
    expect(declined.narrative.adverseAction).toMatch(/declined/i);
  });

  it('says so explicitly when a decline rests on compliance rather than credit', () => {
    // Regression: an otherwise-approvable agent blocked only by an unreachable
    // screening service had its notice cite LIMITED_CREDIT_MIX — a credit
    // reason that played no part in the refusal. Citing an incidental credit
    // weakness for a compliance block tells the applicant something untrue
    // about why they were declined.
    const p = profile();
    expect(p.currentScore).toBeGreaterThan(700); // would approve on credit alone

    const r = build(p, clearSanctions({
      clear: false,
      detail: 'entity screen unavailable (call_failed)',
      entityScreen: { checked: false, clear: false, reason: 'call_failed' },
    }));

    expect(r.decision.outcome).toBe('decline');
    expect(r.decision.declineBasis).toBe('compliance');
    expect(r.decision.adverseActionCodes).toEqual([]);
    expect(r.narrative.adverseAction).toMatch(/compliance grounds, not on credit grounds/i);
    expect(r.narrative.adverseAction).not.toMatch(/credit mix/i);
  });

  it('cites borrower-attributable reasons on a genuine credit decline', () => {
    const r = build(profile({
      creditHistory: Array.from({ length: 14 }, (_, i) =>
        event({ eventType: 'default', timestamp: new Date(NOW - (i * 12 + 5) * DAY).toISOString() }),
      ),
      paymentHistoryRate: 0.1,
      utilizationRate: 0.95,
      totalDebt: 47_500,
    }));
    expect(r.decision.outcome).toBe('decline');
    expect(r.decision.declineBasis).toBe('credit');
    expect(r.decision.adverseActionCodes.length).toBeGreaterThan(0);
    for (const code of r.decision.adverseActionCodes) {
      expect(reasonCodeDefinition(code)?.adverseAction).toBe(true);
    }
  });

  it('describes an empty file without inventing activity', () => {
    const r = build(profile({ creditHistory: [] }));
    expect(r.narrative.activity).toMatch(/No credit activity/i);
  });
});

// ── Markdown ──────────────────────────────────────────────────────────────────

describe('renderLenderReportMarkdown', () => {
  it('renders the same decision the JSON carries', () => {
    const r = build(profile());
    const md = renderLenderReportMarkdown(r);
    expect(md).toContain(`# Credit Report — ${r.agentId}`);
    expect(md).toContain(String(r.decision.score));
    expect(md).toContain(r.requestorName);
    for (const code of r.decision.reasonCodes) expect(md).toContain(code.code);
  });

  it('includes an adverse action section only on a decline', () => {
    expect(renderLenderReportMarkdown(build(profile()))).not.toContain('Adverse action notice');

    const declined = build(profile(), clearSanctions({
      clear: false, detail: 'match',
      entityScreen: {
        checked: true, clear: false,
        result: {
          entity_id: 'a', entity_type: 'business', name: 'X',
          screened_at: new Date(NOW).toISOString(),
          result: 'confirmed_match', matches: [], risk_score: 99, recommended_action: 'block',
        },
      },
    }));
    expect(renderLenderReportMarkdown(declined)).toContain('Adverse action notice');
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────

describe('lender report API', () => {
  let app: FastifyInstance;
  const AGENT = 'agent_prime_001';   // seeded

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  async function consentFor(requestorId: string, agentId = AGENT): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/v1/consent', headers: bearer(ADMIN),
      payload: { agentId, requestorId, purpose: 'credit_application' },
    });
    return res.json().data.consentToken;
  }

  // Every successful pull now debits INQUIRY_FEE_USD from the requestor's
  // prepaid balance, so a fresh requestorId (every test below uses one) needs
  // funding first or the pull is refused with 402, not issued.
  async function fund(requestorId: string, amountUsd = 1_000): Promise<void> {
    await app.inject({
      method: 'POST', url: `/v1/billing/${requestorId}/credit`, headers: bearer(ADMIN),
      payload: { amountUsd, reason: 'test fixture funding' },
    });
  }

  async function pull(requestorId: string, over: Record<string, unknown> = {}) {
    await fund(requestorId);
    const consentToken = await consentFor(requestorId);
    return app.inject({
      method: 'POST', url: '/v1/lender-reports', headers: bearer(ADMIN),
      payload: {
        agentId: AGENT, requestorId, requestorName: 'Test Lender',
        purpose: 'credit_application', consentToken, ...over,
      },
    });
  }

  it('publishes a resolvable vocabulary for autonomous underwriters', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/lender-reports/schema', headers: bearer(ADMIN) });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.schemaVersion).toBe(LENDER_REPORT_SCHEMA_VERSION);
    expect(d.reasonCodes.length).toBe(REASON_CODE_CATALOG.length);
    expect(d.outcomes).toHaveProperty('approve');
    expect(d.scoreScale).toEqual({ min: 0, max: 1000 });
  });

  it('refuses a pull with no valid consent, and records no inquiry', async () => {
    const before = (await app.inject({
      method: 'GET', url: `/v1/agents/${AGENT}/profile`, headers: bearer(ADMIN),
    })).json().data.hardInquiries.length;

    const res = await app.inject({
      method: 'POST', url: '/v1/lender-reports', headers: bearer(ADMIN),
      payload: {
        agentId: AGENT, requestorId: 'mfi_x', requestorName: 'MFI X',
        purpose: 'credit_application', consentToken: 'x',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('ConsentInvalid');

    const after = (await app.inject({
      method: 'GET', url: `/v1/agents/${AGENT}/profile`, headers: bearer(ADMIN),
    })).json().data.hardInquiries.length;
    expect(after).toBe(before);
  });

  it('issues a full report and records the hard inquiry', async () => {
    const before = (await app.inject({
      method: 'GET', url: `/v1/agents/${AGENT}/profile`, headers: bearer(ADMIN),
    })).json().data.hardInquiries.length;

    const res = await pull('mfi_alpha');
    expect(res.statusCode).toBe(201);

    const r = res.json().data;
    expect(r.schemaVersion).toBe(LENDER_REPORT_SCHEMA_VERSION);
    expect(r.agentId).toBe(AGENT);
    expect(r.decision.outcome).toBeDefined();
    expect(r.decision.reasonCodes.length).toBeGreaterThan(0);
    expect(r.narrative.headline).toBeTruthy();
    expect(r.activity.windows.allTime).toBeDefined();
    expect(r.disclosures.inquiryRecorded).toBe(true);

    const after = (await app.inject({
      method: 'GET', url: `/v1/agents/${AGENT}/profile`, headers: bearer(ADMIN),
    })).json().data.hardInquiries.length;
    expect(after).toBe(before + 1);
  });

  it('emits only codes the published schema can resolve', async () => {
    const r = (await pull('mfi_vocab')).json().data;
    for (const c of r.decision.reasonCodes) {
      expect(reasonCodeDefinition(c.code), `${c.code} unresolvable`).toBeDefined();
    }
  });

  it('serves the human rendering of the same report on request', async () => {
    const created = (await pull('mfi_md')).json().data;

    const md = await app.inject({
      method: 'GET', url: `/v1/lender-reports/${created.reportId}`,
      headers: { ...bearer(ADMIN), accept: 'text/markdown' },
    });
    expect(md.statusCode).toBe(200);
    expect(md.headers['content-type']).toContain('text/markdown');
    expect(md.body).toContain(`# Credit Report — ${AGENT}`);
    expect(md.body).toContain(String(created.decision.score));

    // ?format= wins for callers that cannot set an Accept header.
    const viaQuery = await app.inject({
      method: 'GET', url: `/v1/lender-reports/${created.reportId}?format=markdown`,
      headers: { ...bearer(ADMIN), accept: 'text/html' },
    });
    expect(viaQuery.headers['content-type']).toContain('text/markdown');
  });

  it('returns the report as issued, not a fresh assessment', async () => {
    const created = (await pull('mfi_stable')).json().data;
    // Another pull moves the profile (an inquiry is itself a small penalty).
    await pull('mfi_stable_other');

    const fetched = (await app.inject({
      method: 'GET', url: `/v1/lender-reports/${created.reportId}`, headers: bearer(ADMIN),
    })).json().data;
    expect(fetched.decision.score).toBe(created.decision.score);
    expect(fetched.generatedAt).toBe(created.generatedAt);
  });

  it('404s an unknown report', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/lender-reports/lr_nope', headers: bearer(ADMIN),
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a malformed request body', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/lender-reports', headers: bearer(ADMIN),
      payload: { agentId: AGENT },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ValidationError');
  });

  it('404s a pull against an unknown agent', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/lender-reports', headers: bearer(ADMIN),
      payload: {
        agentId: 'agent_does_not_exist', requestorId: 'mfi_y', requestorName: 'MFI Y',
        purpose: 'credit_application', consentToken: 'x',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/lender-reports/schema' });
    expect(res.statusCode).toBe(401);
  });

  it('lists a lender its own issued reports as summaries', async () => {
    await pull('mfi_hist');
    const res = await app.inject({
      method: 'GET', url: '/v1/lender-reports?requestorId=mfi_hist', headers: bearer(ADMIN),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('outcome');
    // Summaries only — a listing must not re-disclose whole credit files.
    expect(rows[0]).not.toHaveProperty('activity');
    expect(rows[0]).not.toHaveProperty('narrative');
  });
});

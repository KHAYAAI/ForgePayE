/**
 * Lender report — the underwriting packet a third-party lender (MFI, bank,
 * DeFi protocol) receives about an AI agent before extending it credit.
 *
 * Why this exists alongside `POST /v1/reports`:
 *
 *   `/v1/reports` returns the *credit file* — the raw bureau record, including
 *   the full untruncated `creditHistory` array. That is the right product for
 *   an agent auditing its own data, or a regulator, and the wrong one for a
 *   loan officer: it answers "what do you hold on this agent" rather than
 *   "should we lend to it, how much, and why". Incumbent bureaux sell both.
 *   This module is the second product.
 *
 * The dual-audience requirement — readable by a human credit officer AND by an
 * AI agent underwriting autonomously — is met by construction, not by shipping
 * two documents that can drift apart:
 *
 *   1. Every human sentence in `narrative` is *generated from* the structured
 *      fields in the same object. There is no path by which the prose can say
 *      something the data does not. This is the same single-source-of-truth
 *      rule `deriveScoreFields()` enforces for scores.
 *
 *   2. Every machine-readable code the report can emit is enumerable at
 *      runtime via `REASON_CODE_CATALOG`, served from
 *      `GET /v1/lender-reports/schema`. An agent that encounters a code it was
 *      not written against can resolve its meaning, polarity and adverse-action
 *      eligibility without out-of-band documentation — including codes added
 *      after that agent was deployed. A JSON body alone is not
 *      machine-understandable; a JSON body whose vocabulary is self-describing
 *      is.
 *
 *   3. `Accept: text/markdown` renders the human view of the *same* report id,
 *      from the same object, via `renderLenderReportMarkdown()`.
 *
 * Three things a lender needs that the raw file does not surface, and which
 * this report adds:
 *
 *   - **Activity, summarised.** A lender underwrites behaviour over time, not
 *     an event array. Volume, counts, payment outcomes and velocity are rolled
 *     into 30/90/365-day windows with a trend.
 *
 *   - **Data sufficiency.** A 780 built on two events from one furnisher is not
 *     the same asset as a 780 built on two hundred from five, and a lender that
 *     cannot tell them apart is mispricing risk. Sufficiency is reported
 *     explicitly and can downgrade an automated approval to manual review —
 *     never silently: `decision.scoreBasedOutcome` always shows what the score
 *     alone said, so the adjustment is auditable rather than hidden.
 *
 *   - **Adverse-action reasons.** A regulated lender declining an application
 *     must state why, in ranked specific reasons (FCRA §615 in the US and its
 *     equivalents elsewhere). Only codes flagged `adverseAction: true` are
 *     eligible — "short credit history" is a lawful reason to decline, an
 *     absent sanctions screen is a data-quality problem and must not be
 *     laundered into one.
 */

import type {
  AgentCreditProfile,
  CreditEvent,
  CreditTier,
  ScoreFactor,
} from './types';
import { creditGrade, type GradeLetter, INQUIRY_FEE_USD } from './grade';
import { maxRecommendedLimit, scoreRecommendation } from './scorer';
import type { SanctionsResult } from './verify';

export const LENDER_REPORT_SCHEMA_VERSION = 'forge.lender-report.v1';

export type DecisionOutcome =
  | 'approve'
  | 'approve_with_conditions'
  | 'manual_review'
  | 'decline';

export type Confidence = 'high' | 'moderate' | 'low';

/**
 * Why a decline happened. The distinction is load-bearing for both audiences:
 * a `compliance` block is a condition on the bureau's side or a legal
 * prohibition, and an autonomous underwriter should treat it as retryable once
 * screening succeeds; a `credit` decline is a judgement about the borrower and
 * is the only kind that may cite adverse-action reasons.
 */
export type DeclineBasis = 'credit' | 'compliance';

export type LenderReportPurpose =
  | 'credit_application'
  | 'account_review'
  | 'employment'
  | 'insurance';

// ── Reason codes ──────────────────────────────────────────────────────────────

/**
 * A single ranked reason behind the decision.
 *
 * `statement` is the human sentence; `code` is the machine handle. Both are
 * always present so neither audience has to parse the other's representation.
 */
export interface ReasonCode {
  code: string;
  polarity: 'positive' | 'negative' | 'neutral';
  /** Relative contribution, 0–100. Ranking key for adverse-action ordering. */
  weight: number;
  statement: string;
  /** May this reason lawfully be cited in a decline/adverse-action notice? */
  adverseAction: boolean;
}

export interface ReasonCodeDefinition {
  code: string;
  meaning: string;
  polarity: 'positive' | 'negative' | 'neutral';
  adverseAction: boolean;
  /** Which part of the report this code is derived from. */
  source: 'score_factor' | 'data_sufficiency' | 'compliance' | 'exposure';
}

/**
 * Every code this service can emit, with its meaning. Served verbatim from
 * `GET /v1/lender-reports/schema` so an autonomous underwriter can resolve any
 * code it encounters at runtime instead of shipping a hardcoded copy that goes
 * stale the moment the scorer gains a factor.
 *
 * Codes sourced from `score_factor` mirror the codes `computeScore()` emits in
 * `scorer.ts` — kept in sync by `lender-report.test.ts`, which asserts every
 * factor code the scorer can produce has an entry here. Mode 2 (on-chain)
 * factor codes are deliberately absent: a lender report is built off
 * `profile.scoreFactors`, which is Mode 1 only, and Mode 1 is the authoritative
 * lending lens per the dual-mode design.
 */
export const REASON_CODE_CATALOG: ReasonCodeDefinition[] = [
  // Payment history (35% of score)
  { code: 'STRONG_PAYMENT_HISTORY', meaning: 'Payments have been made on time at a high rate.', polarity: 'positive', adverseAction: false, source: 'score_factor' },
  { code: 'LATE_PAYMENTS',          meaning: 'Late payments are present on the record.',        polarity: 'negative', adverseAction: true,  source: 'score_factor' },
  { code: 'RECENT_DEFAULT',         meaning: 'One or more accounts are in default.',            polarity: 'negative', adverseAction: true,  source: 'score_factor' },

  // Utilisation (30%)
  { code: 'LOW_UTILIZATION',  meaning: 'Credit utilisation is within a healthy range.',                  polarity: 'positive', adverseAction: false, source: 'score_factor' },
  { code: 'HIGH_UTILIZATION', meaning: 'Credit utilisation exceeds 50% of the available limit.',         polarity: 'negative', adverseAction: true,  source: 'score_factor' },

  // Age of file (15%)
  { code: 'ESTABLISHED_HISTORY',   meaning: 'The agent has a substantial operating history with the bureau.', polarity: 'positive', adverseAction: false, source: 'score_factor' },
  { code: 'SHORT_CREDIT_HISTORY',  meaning: 'The agent has been on file for under six months.',              polarity: 'negative', adverseAction: true,  source: 'score_factor' },

  // Mix (10%)
  { code: 'DIVERSE_CREDIT_MIX', meaning: 'A varied mix of credit types and activity is on record.', polarity: 'positive', adverseAction: false, source: 'score_factor' },
  { code: 'LIMITED_CREDIT_MIX', meaning: 'Limited variety of credit types on record.',              polarity: 'neutral',  adverseAction: true,  source: 'score_factor' },

  // Velocity (10%)
  { code: 'HIGH_INQUIRY_VELOCITY', meaning: 'Multiple hard inquiries in the last 30 days, which can indicate credit stress.', polarity: 'negative', adverseAction: true, source: 'score_factor' },

  // Data sufficiency — about the file, not the borrower.
  { code: 'THIN_FILE',                              meaning: 'Few records on file; the score carries wider uncertainty than usual.',                   polarity: 'neutral', adverseAction: false, source: 'data_sufficiency' },
  { code: 'SINGLE_FURNISHER_CONCENTRATION',         meaning: 'All records come from one furnisher, so nothing corroborates them.',                     polarity: 'neutral', adverseAction: false, source: 'data_sufficiency' },
  { code: 'INSUFFICIENT_DATA_FOR_AUTOMATED_DECISION', meaning: 'Too little history to decide automatically; routed to manual review.',                 polarity: 'neutral', adverseAction: false, source: 'data_sufficiency' },
  { code: 'STALE_FILE',                             meaning: 'No new records for over 180 days; the file may not reflect current behaviour.',          polarity: 'neutral', adverseAction: false, source: 'data_sufficiency' },

  // Compliance — never adverse-action eligible. A screening gap is the
  // bureau's problem to fix, not a lawful reason to decline a borrower.
  { code: 'SANCTIONS_MATCH',           meaning: 'The agent or its operator matched a sanctions list. Lending is prohibited.',              polarity: 'negative', adverseAction: false, source: 'compliance' },
  { code: 'SANCTIONS_SCREEN_UNAVAILABLE', meaning: 'Sanctions screening could not be completed; compliance status is unknown, not clear.', polarity: 'negative', adverseAction: false, source: 'compliance' },
  { code: 'IDENTITY_UNVERIFIED',       meaning: 'The operating entity behind this agent has not been identity-verified.',                  polarity: 'negative', adverseAction: false, source: 'compliance' },
  { code: 'PROFILE_FROZEN',            meaning: 'The credit profile is frozen under a legal or sanctions hold.',                           polarity: 'negative', adverseAction: false, source: 'compliance' },

  // Exposure
  { code: 'OPEN_DELINQUENCY',      meaning: 'One or more delinquencies are currently unresolved.',            polarity: 'negative', adverseAction: true,  source: 'exposure' },
  { code: 'NO_AVAILABLE_HEADROOM', meaning: 'Existing debt already meets or exceeds the recommended limit.',  polarity: 'negative', adverseAction: true,  source: 'exposure' },
];

const CATALOG_BY_CODE = new Map(REASON_CODE_CATALOG.map(d => [d.code, d]));

/** Look a code up in the catalog. Exported for the schema route and tests. */
export function reasonCodeDefinition(code: string): ReasonCodeDefinition | undefined {
  return CATALOG_BY_CODE.get(code);
}

// ── Activity ──────────────────────────────────────────────────────────────────

export interface ActivityWindow {
  /** Window length in days; null for all-time. */
  days: number | null;
  events: number;
  volumeUsd: number;
  onTimePayments: number;
  latePayments: number;
  defaults: number;
  newCreditLines: number;
}

export type ActivityTrend =
  | 'increasing'
  | 'stable'
  | 'decreasing'
  | 'dormant'
  | 'insufficient_data';

export interface ActivitySummary {
  firstSeenAt: string | null;
  lastActiveAt: string | null;
  accountAgeMonths: number;
  daysSinceLastActivity: number | null;
  trend: ActivityTrend;
  windows: {
    last30d: ActivityWindow;
    last90d: ActivityWindow;
    last365d: ActivityWindow;
    allTime: ActivityWindow;
  };
  paymentBehaviour: {
    onTime: number;
    late30: number;
    late60: number;
    late90: number;
    defaults: number;
    onTimeRatePct: number | null;
  };
  inquiryVelocity: { last30d: number; last90d: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyWindow(days: number | null): ActivityWindow {
  return { days, events: 0, volumeUsd: 0, onTimePayments: 0, latePayments: 0, defaults: 0, newCreditLines: 0 };
}

function accumulate(window: ActivityWindow, event: CreditEvent): void {
  window.events += 1;
  window.volumeUsd += event.amount ?? 0;
  switch (event.eventType) {
    case 'payment_on_time':  window.onTimePayments += 1; break;
    case 'payment_late_30':
    case 'payment_late_60':
    case 'payment_late_90':  window.latePayments += 1; break;
    case 'default':          window.defaults += 1; break;
    case 'credit_opened':    window.newCreditLines += 1; break;
    default: break;
  }
}

/**
 * Roll the raw event array into the windows a lender actually underwrites on.
 *
 * Trend compares the most recent 90 days against the 90 before it, so a lender
 * can see direction rather than only a snapshot. Under three events in the
 * whole 180-day span there is nothing to compare and the trend reports
 * `insufficient_data` rather than inventing a direction from noise.
 */
export function summariseActivity(
  profile: AgentCreditProfile,
  nowMs: number = Date.now(),
): ActivitySummary {
  const windows = {
    last30d:  emptyWindow(30),
    last90d:  emptyWindow(90),
    last365d: emptyWindow(365),
    allTime:  emptyWindow(null),
  };

  const behaviour = { onTime: 0, late30: 0, late60: 0, late90: 0, defaults: 0 };

  let firstSeenMs: number | null = null;
  let lastActiveMs: number | null = null;

  // Trend halves: [now-90d, now] vs [now-180d, now-90d].
  let recentHalf = 0;
  let priorHalf = 0;

  for (const event of profile.creditHistory) {
    const ts = Date.parse(event.timestamp);
    if (Number.isNaN(ts)) continue;

    if (firstSeenMs === null || ts < firstSeenMs) firstSeenMs = ts;
    if (lastActiveMs === null || ts > lastActiveMs) lastActiveMs = ts;

    const ageMs = nowMs - ts;
    accumulate(windows.allTime, event);
    if (ageMs <= 365 * DAY_MS) accumulate(windows.last365d, event);
    if (ageMs <= 90 * DAY_MS)  accumulate(windows.last90d, event);
    if (ageMs <= 30 * DAY_MS)  accumulate(windows.last30d, event);

    if (ageMs <= 90 * DAY_MS) recentHalf += 1;
    else if (ageMs <= 180 * DAY_MS) priorHalf += 1;

    switch (event.eventType) {
      case 'payment_on_time': behaviour.onTime += 1; break;
      case 'payment_late_30': behaviour.late30 += 1; break;
      case 'payment_late_60': behaviour.late60 += 1; break;
      case 'payment_late_90': behaviour.late90 += 1; break;
      case 'default':         behaviour.defaults += 1; break;
      default: break;
    }
  }

  const totalPayments = behaviour.onTime + behaviour.late30 + behaviour.late60 + behaviour.late90;
  const onTimeRatePct = totalPayments === 0
    ? null
    : Math.round((behaviour.onTime / totalPayments) * 100);

  const daysSinceLastActivity = lastActiveMs === null
    ? null
    : Math.floor((nowMs - lastActiveMs) / DAY_MS);

  let trend: ActivityTrend;
  if (daysSinceLastActivity !== null && daysSinceLastActivity > 180) {
    trend = 'dormant';
  } else if (recentHalf + priorHalf < 3) {
    trend = 'insufficient_data';
  } else if (recentHalf > priorHalf * 1.25) {
    trend = 'increasing';
  } else if (recentHalf * 1.25 < priorHalf) {
    trend = 'decreasing';
  } else {
    trend = 'stable';
  }

  const createdMs = Date.parse(profile.createdAt);
  const accountAgeMonths = Number.isNaN(createdMs)
    ? 0
    : Math.max(0, (nowMs - createdMs) / (DAY_MS * 30.44));

  const inquiries = profile.hardInquiries ?? [];
  const inquiriesWithin = (days: number) =>
    inquiries.filter(i => {
      const ts = Date.parse(i.timestamp);
      return !Number.isNaN(ts) && nowMs - ts <= days * DAY_MS;
    }).length;

  return {
    firstSeenAt: firstSeenMs === null ? null : new Date(firstSeenMs).toISOString(),
    lastActiveAt: lastActiveMs === null ? null : new Date(lastActiveMs).toISOString(),
    accountAgeMonths: Math.round(accountAgeMonths * 10) / 10,
    daysSinceLastActivity,
    trend,
    windows,
    paymentBehaviour: { ...behaviour, onTimeRatePct },
    inquiryVelocity: { last30d: inquiriesWithin(30), last90d: inquiriesWithin(90) },
  };
}

// ── Data sufficiency ──────────────────────────────────────────────────────────

export type SufficiencyLevel = 'thick_file' | 'thin_file' | 'insufficient';

export interface DataSufficiency {
  level: SufficiencyLevel;
  confidence: Confidence;
  eventCount: number;
  furnisherCount: number;
  monthsOfHistory: number;
  /** Plain-language limitations a lender should weigh before relying on this. */
  caveats: string[];
}

/** Below this many events the file cannot support an automated approval. */
const MIN_EVENTS_FOR_AUTOMATED_DECISION = 3;
const THICK_FILE_EVENTS = 12;
const THICK_FILE_MONTHS = 6;
const STALE_FILE_DAYS = 180;

/**
 * How much the file can actually support.
 *
 * Deliberately counts *distinct furnishers*, not just events: twenty records
 * from a single lender are one counterparty's view, and the bureau's own threat
 * model names a captured furnisher as the way Mode 1 gets inflated. A lender
 * relying on this score deserves to be told when nothing corroborates it.
 */
export function assessDataSufficiency(
  profile: AgentCreditProfile,
  activity: ActivitySummary,
): DataSufficiency {
  const eventCount = profile.creditHistory.length;

  const furnishers = new Set<string>();
  for (const event of profile.creditHistory) {
    if (event.contributorId) furnishers.add(event.contributorId);
  }
  const furnisherCount = furnishers.size;
  const monthsOfHistory = activity.accountAgeMonths;

  const caveats: string[] = [];

  let level: SufficiencyLevel;
  if (eventCount < MIN_EVENTS_FOR_AUTOMATED_DECISION) {
    level = 'insufficient';
    caveats.push(
      `Only ${eventCount} record(s) on file — below the ${MIN_EVENTS_FOR_AUTOMATED_DECISION} needed to decide automatically.`,
    );
  } else if (eventCount >= THICK_FILE_EVENTS && monthsOfHistory >= THICK_FILE_MONTHS) {
    level = 'thick_file';
  } else {
    level = 'thin_file';
    // Phrased as the implication rather than a restatement of the counts: the
    // narrative always prints the composition immediately before the caveats,
    // and repeating it there read as a stutter.
    caveats.push(
      `Below the thick-file threshold of ${THICK_FILE_EVENTS} records over ${THICK_FILE_MONTHS} months — ` +
      'the score carries wider uncertainty than a fully-populated file.',
    );
  }

  if (furnisherCount <= 1 && eventCount > 0) {
    caveats.push(
      furnisherCount === 0
        ? 'No records carry furnisher attribution, so their provenance cannot be checked.'
        : 'All records come from a single furnisher — nothing independently corroborates them.',
    );
  }

  if (activity.daysSinceLastActivity !== null && activity.daysSinceLastActivity > STALE_FILE_DAYS) {
    caveats.push(
      `No new records for ${activity.daysSinceLastActivity} days — the file may not reflect current behaviour.`,
    );
  }

  const confidence: Confidence =
    level === 'insufficient' ? 'low'
    : level === 'thin_file' || furnisherCount <= 1 || caveats.length > 0 ? 'moderate'
    : 'high';

  return { level, confidence, eventCount, furnisherCount, monthsOfHistory, caveats };
}

// ── Report shape ──────────────────────────────────────────────────────────────

export interface ExposureSummary {
  totalDebtUsd: number;
  totalCreditLimitUsd: number;
  availableCreditUsd: number;
  utilizationRatePct: number;
  openDelinquencies: number;
  worstDelinquencyDaysLate: number | null;
  /** Recommended limit minus current debt. Negative means already over. */
  headroomVsRecommendedUsd: number;
}

export interface ComplianceEvidence {
  sanctionsClear: boolean;
  /** Which screens actually ran — 'local' is self-reported, the rest are real list checks. */
  sanctionsChecksPerformed: string[];
  sanctionsDetail: string;
  screenedAt: string;
  identityVerified: boolean;
  profileFrozen: boolean;
  frozenAt?: string;
}

export interface FurnisherAttribution {
  contributorId: string;
  name: string;
  recordsContributed: number;
}

export interface LenderReportNarrative {
  headline: string;
  summary: string;
  activity: string;
  risk: string;
  recommendation: string;
  /** Present only when the outcome is `decline`. */
  adverseAction?: string;
}

export interface LenderReport {
  reportId: string;
  schemaVersion: typeof LENDER_REPORT_SCHEMA_VERSION;
  agentId: string;
  did: string;
  requestorId: string;
  requestorName: string;
  purpose: LenderReportPurpose;
  generatedAt: string;
  expiresAt: string;

  decision: {
    outcome: DecisionOutcome;
    /** What the score alone recommended, before any sufficiency adjustment. */
    scoreBasedOutcome: DecisionOutcome;
    /** Set when `outcome` differs from `scoreBasedOutcome`, explaining why. */
    adjustmentReason?: string;
    score: number;
    scoreScale: { min: number; max: number };
    tier: CreditTier;
    grade: GradeLetter;
    riskLevel: string;
    investmentGrade: boolean;
    maxRecommendedLimitUsd: number;
    confidence: Confidence;
    reasonCodes: ReasonCode[];
    /**
     * Set only when declining. `compliance` means the refusal came from a
     * sanctions or legal condition and is retryable once that clears;
     * `credit` means it is a judgement about the borrower.
     */
    declineBasis?: DeclineBasis;
    /**
     * Codes citable in a decline notice, ranked. Empty unless this is a
     * credit-based decline — a compliance block has no borrower-attributable
     * reason to cite.
     */
    adverseActionCodes: string[];
    conditions: string[];
  };

  activity: ActivitySummary;
  exposure: ExposureSummary;

  evidence: {
    dataSufficiency: DataSufficiency;
    compliance: ComplianceEvidence;
    furnishers: FurnisherAttribution[];
    profileLastUpdatedAt: string;
  };

  narrative: LenderReportNarrative;

  disclosures: {
    inquiryFeeUsd: number;
    inquiryRecorded: boolean;
    expiresInDays: number;
    disputeRights: string;
    scoreBasis: string;
    limitations: string;
  };
}

// ── Reason assembly ───────────────────────────────────────────────────────────

function toReasonCode(factor: ScoreFactor): ReasonCode {
  const def = reasonCodeDefinition(factor.code);
  return {
    code: factor.code,
    polarity: factor.impact,
    weight: factor.weight,
    statement: factor.description,
    // An unknown code is never adverse-action eligible. A scorer factor added
    // without a catalog entry must not silently become a lawful decline reason;
    // the test suite fails the build instead.
    adverseAction: def?.adverseAction ?? false,
  };
}

function syntheticReason(
  code: string,
  weight: number,
  statement: string,
): ReasonCode {
  const def = reasonCodeDefinition(code);
  return {
    code,
    polarity: def?.polarity ?? 'neutral',
    weight,
    statement,
    adverseAction: def?.adverseAction ?? false,
  };
}

// ── Builder ───────────────────────────────────────────────────────────────────

export interface BuildLenderReportInput {
  reportId: string;
  profile: AgentCreditProfile;
  requestorId: string;
  requestorName: string;
  purpose: LenderReportPurpose;
  sanctions: SanctionsResult;
  /** id → display name, for furnisher attribution. */
  furnisherNames?: Map<string, string>;
  /** Whether this pull recorded a hard inquiry on the agent's file. */
  inquiryRecorded?: boolean;
  nowMs?: number;
  expiryDays?: number;
}

const DEFAULT_EXPIRY_DAYS = 30;

/**
 * Assemble the report. Pure — no I/O, no store access, no clock unless the
 * caller declines to supply one, so the whole thing is testable and the same
 * inputs always produce the same document.
 *
 * The score is taken from the profile rather than recomputed. `deriveScoreFields`
 * is the only thing allowed to compute a score in this service, and a report
 * that recalculated it independently is exactly the drift that rule exists to
 * prevent.
 */
export function buildLenderReport(input: BuildLenderReportInput): LenderReport {
  const {
    reportId, profile, requestorId, requestorName, purpose, sanctions,
    furnisherNames, inquiryRecorded = true,
  } = input;

  const nowMs = input.nowMs ?? Date.now();
  const expiryDays = input.expiryDays ?? DEFAULT_EXPIRY_DAYS;
  const now = new Date(nowMs);

  const activity = summariseActivity(profile, nowMs);
  const sufficiency = assessDataSufficiency(profile, activity);

  const score = profile.currentScore;
  const grade = creditGrade(score);
  const recommendedLimit = maxRecommendedLimit(score);
  const scoreBasedOutcome = scoreRecommendation(score);

  // ── Exposure ──
  const availableCredit = Math.max(0, profile.totalCreditLimit - profile.totalDebt);
  const openDelinquencies = profile.delinquencies.filter(d => d.status === 'open');
  const worstDelinquencyDaysLate = openDelinquencies.length === 0
    ? null
    : Math.max(...openDelinquencies.map(d => d.daysLate));

  const exposure: ExposureSummary = {
    totalDebtUsd: profile.totalDebt,
    totalCreditLimitUsd: profile.totalCreditLimit,
    availableCreditUsd: availableCredit,
    utilizationRatePct: Math.round(profile.utilizationRate * 100),
    openDelinquencies: openDelinquencies.length,
    worstDelinquencyDaysLate,
    headroomVsRecommendedUsd: recommendedLimit - profile.totalDebt,
  };

  // ── Compliance evidence ──
  const identityVerified =
    profile.operatorEntityId.length > 0 &&
    (profile.creditHistory.some(e => e.eventType === 'identity_verified') || profile.did.startsWith('did:'));

  const compliance: ComplianceEvidence = {
    sanctionsClear: sanctions.clear,
    sanctionsChecksPerformed: sanctions.checked,
    sanctionsDetail: sanctions.detail,
    screenedAt: sanctions.screenedAt,
    identityVerified,
    profileFrozen: !!profile.frozenAt,
    ...(profile.frozenAt ? { frozenAt: profile.frozenAt } : {}),
  };

  // ── Reasons ──
  const reasonCodes: ReasonCode[] = profile.scoreFactors.map(toReasonCode);

  if (openDelinquencies.length > 0) {
    reasonCodes.push(syntheticReason(
      'OPEN_DELINQUENCY',
      40,
      `${openDelinquencies.length} unresolved delinquenc${openDelinquencies.length === 1 ? 'y' : 'ies'}` +
      (worstDelinquencyDaysLate !== null ? `, worst ${worstDelinquencyDaysLate} days late.` : '.'),
    ));
  }
  if (recommendedLimit > 0 && exposure.headroomVsRecommendedUsd <= 0) {
    reasonCodes.push(syntheticReason(
      'NO_AVAILABLE_HEADROOM',
      30,
      `Existing debt of $${profile.totalDebt.toLocaleString()} already meets the recommended limit of $${recommendedLimit.toLocaleString()}.`,
    ));
  }
  if (sufficiency.level === 'thin_file') {
    reasonCodes.push(syntheticReason('THIN_FILE', 20, sufficiency.caveats[0] ?? 'Thin file.'));
  }
  if (sufficiency.furnisherCount <= 1 && sufficiency.eventCount > 0) {
    reasonCodes.push(syntheticReason(
      'SINGLE_FURNISHER_CONCENTRATION',
      15,
      'All records come from a single furnisher — nothing independently corroborates them.',
    ));
  }
  if (activity.daysSinceLastActivity !== null && activity.daysSinceLastActivity > STALE_FILE_DAYS) {
    reasonCodes.push(syntheticReason(
      'STALE_FILE',
      15,
      `No new records for ${activity.daysSinceLastActivity} days.`,
    ));
  }
  if (!identityVerified) {
    reasonCodes.push(syntheticReason('IDENTITY_UNVERIFIED', 50, 'The operating entity behind this agent has not been identity-verified.'));
  }
  if (profile.frozenAt) {
    reasonCodes.push(syntheticReason('PROFILE_FROZEN', 100, `Profile frozen since ${profile.frozenAt}.`));
  }

  // Sanctions splits two ways, and the distinction matters to a lender: an
  // actual list match is a hard legal block, while an unreachable screening
  // service is an unknown. Neither is adverse-action eligible, and neither may
  // be reported as "clear".
  const sanctionsUnavailable =
    !sanctions.clear &&
    ((sanctions.addressScreen && !sanctions.addressScreen.checked) ||
     (sanctions.entityScreen && !sanctions.entityScreen.checked));

  if (!sanctions.clear) {
    reasonCodes.push(sanctionsUnavailable
      ? syntheticReason('SANCTIONS_SCREEN_UNAVAILABLE', 90, sanctions.detail)
      : syntheticReason('SANCTIONS_MATCH', 100, sanctions.detail));
  }

  reasonCodes.sort((a, b) => b.weight - a.weight);

  // ── Outcome ──
  let outcome: DecisionOutcome = scoreBasedOutcome;
  let adjustmentReason: string | undefined;

  // Tracks *why* a decline happened, which decides whether any borrower-
  // attributable reason may be cited. A compliance block is not a credit
  // judgement and must never be reported as one.
  let declineBasis: DeclineBasis | undefined;

  if (!sanctions.clear || profile.frozenAt) {
    outcome = 'decline';
    declineBasis = 'compliance';
    adjustmentReason = profile.frozenAt
      ? 'Profile is frozen under a legal or sanctions hold — lending is blocked regardless of score.'
      : sanctionsUnavailable
        ? 'Sanctions screening could not be completed, so compliance status is unknown. Declined pending a successful screen rather than treated as clear.'
        : 'The agent or its operator matched a sanctions list — lending is prohibited regardless of score.';
  } else if (outcome === 'decline') {
    declineBasis = 'credit';
  } else if (sufficiency.level === 'insufficient') {
    outcome = 'manual_review';
    adjustmentReason =
      `The score alone recommended '${scoreBasedOutcome}', but the file holds only ` +
      `${sufficiency.eventCount} record(s) — too little to decide automatically. Routed to manual review.`;
    reasonCodes.unshift(syntheticReason(
      'INSUFFICIENT_DATA_FOR_AUTOMATED_DECISION',
      60,
      `Only ${sufficiency.eventCount} record(s) on file.`,
    ));
  }

  // ── Conditions ──
  const conditions: string[] = [];
  if (outcome === 'approve_with_conditions' || outcome === 'approve') {
    if (recommendedLimit > 0) {
      conditions.push(`Cap the facility at $${recommendedLimit.toLocaleString()} (the bureau's recommended maximum at this score).`);
    }
    if (sufficiency.confidence !== 'high') {
      conditions.push('Re-pull before any limit increase — confidence in this file is not high.');
    }
    if (exposure.utilizationRatePct > 50) {
      conditions.push(`Existing utilisation is ${exposure.utilizationRatePct}%; consider requiring paydown before drawdown.`);
    }
    if (activity.inquiryVelocity.last30d >= 2) {
      conditions.push(`${activity.inquiryVelocity.last30d} other lenders pulled this file in the last 30 days — confirm the agent is not shopping the same facility.`);
    }
  }

  // ── Adverse action ──
  //
  // Only a credit-based decline yields citable reasons. When the decline was
  // caused by a compliance condition, the borrower's credit factors did not
  // cause it, and listing them — "declined: limited credit mix" against an
  // otherwise-approvable file blocked by an unreachable sanctions service —
  // would tell the applicant something untrue about why they were refused.
  // That is precisely the misattribution adverse-action rules exist to stop.
  const adverseActionCodes = outcome === 'decline' && declineBasis === 'credit'
    ? reasonCodes.filter(r => r.adverseAction).map(r => r.code).slice(0, 4)
    : [];

  const decision: LenderReport['decision'] = {
    outcome,
    scoreBasedOutcome,
    ...(adjustmentReason ? { adjustmentReason } : {}),
    score,
    scoreScale: { min: 0, max: 1000 },
    tier: profile.tier,
    grade: grade.grade,
    riskLevel: grade.riskLevel,
    investmentGrade: grade.investmentGrade,
    maxRecommendedLimitUsd: recommendedLimit,
    confidence: sufficiency.confidence,
    reasonCodes,
    ...(declineBasis ? { declineBasis } : {}),
    adverseActionCodes,
    conditions,
  };

  // ── Furnisher attribution ──
  const counts = new Map<string, number>();
  for (const event of profile.creditHistory) {
    if (!event.contributorId) continue;
    counts.set(event.contributorId, (counts.get(event.contributorId) ?? 0) + 1);
  }
  const furnishers: FurnisherAttribution[] = [...counts.entries()]
    .map(([contributorId, recordsContributed]) => ({
      contributorId,
      name: furnisherNames?.get(contributorId) ?? contributorId,
      recordsContributed,
    }))
    .sort((a, b) => b.recordsContributed - a.recordsContributed);

  const report: LenderReport = {
    reportId,
    schemaVersion: LENDER_REPORT_SCHEMA_VERSION,
    agentId: profile.agentId,
    did: profile.did,
    requestorId,
    requestorName,
    purpose,
    generatedAt: now.toISOString(),
    expiresAt: new Date(nowMs + expiryDays * DAY_MS).toISOString(),
    decision,
    activity,
    exposure,
    evidence: {
      dataSufficiency: sufficiency,
      compliance,
      furnishers,
      profileLastUpdatedAt: profile.lastUpdatedAt,
    },
    // Placeholder replaced immediately below — narrative is derived from the
    // finished decision/activity/evidence, so it cannot contradict them.
    narrative: { headline: '', summary: '', activity: '', risk: '', recommendation: '' },
    disclosures: {
      inquiryFeeUsd: INQUIRY_FEE_USD,
      inquiryRecorded,
      expiresInDays: expiryDays,
      disputeRights:
        'The agent or its operator may dispute any record in this report via ' +
        'POST /v1/agents/{agentId}/disputes. Disputes are investigated within 30 days.',
      scoreBasis:
        'FORGE Mode 1 score, 0–1000: payment history 35%, utilisation 30%, ' +
        'file age 15%, credit mix 10%, inquiry velocity 10%.',
      limitations:
        'A credit score is a probabilistic assessment of past behaviour, not a guarantee ' +
        'of future performance, and does not constitute a lending decision or financial advice. ' +
        'The lender remains responsible for its own underwriting and compliance obligations.',
    },
  };

  report.narrative = buildNarrative(report);
  return report;
}

// ── Narrative ─────────────────────────────────────────────────────────────────

const OUTCOME_PHRASE: Record<DecisionOutcome, string> = {
  approve: 'Approve',
  approve_with_conditions: 'Approve with conditions',
  manual_review: 'Refer for manual review',
  decline: 'Decline',
};

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Turn the finished structured report into prose.
 *
 * Reads only from `report` — every sentence traces to a field above it, so the
 * human and machine views cannot disagree. This is why the narrative is built
 * last and from the report object rather than alongside it from the raw inputs.
 */
export function buildNarrative(report: LenderReport): LenderReportNarrative {
  const { decision, activity, exposure, evidence, agentId } = report;
  const suff = evidence.dataSufficiency;

  const headline =
    `${OUTCOME_PHRASE[decision.outcome]} — ${agentId} scores ${decision.score}/1000 ` +
    `(${decision.grade}, ${decision.riskLevel.toLowerCase()} risk), ${decision.confidence} confidence.`;

  const summaryParts: string[] = [];
  summaryParts.push(
    `${agentId} holds a FORGE score of ${decision.score} out of 1000, placing it in the ` +
    `${decision.grade} band (${decision.riskLevel.toLowerCase()} risk, ` +
    `${decision.investmentGrade ? 'investment grade' : 'below investment grade'}).`,
  );
  summaryParts.push(
    decision.maxRecommendedLimitUsd > 0
      ? `The bureau's recommended maximum exposure at this score is ${money(decision.maxRecommendedLimitUsd)}.`
      : 'The bureau does not recommend extending credit at this score.',
  );
  if (decision.adjustmentReason) summaryParts.push(decision.adjustmentReason);

  const w365 = activity.windows.last365d;
  const w90 = activity.windows.last90d;
  const activityParts: string[] = [];

  if (activity.windows.allTime.events === 0) {
    activityParts.push('No credit activity has been reported for this agent.');
  } else {
    activityParts.push(
      `Over the last 12 months the agent recorded ${w365.events} credit event(s) ` +
      `totalling ${money(w365.volumeUsd)}, of which ${w365.onTimePayments} were on-time payments` +
      (w365.latePayments > 0 ? ` and ${w365.latePayments} were late` : '') +
      (w365.defaults > 0 ? `, with ${w365.defaults} default(s)` : '') + '.',
    );
    activityParts.push(
      `In the last 90 days: ${w90.events} event(s), ${money(w90.volumeUsd)}. ` +
      `Activity is ${activity.trend.replace(/_/g, ' ')}.`,
    );
    if (activity.paymentBehaviour.onTimeRatePct !== null) {
      activityParts.push(
        `Lifetime on-time payment rate is ${activity.paymentBehaviour.onTimeRatePct}% ` +
        `across ${activity.paymentBehaviour.onTime + activity.paymentBehaviour.late30 + activity.paymentBehaviour.late60 + activity.paymentBehaviour.late90} payment(s).`,
      );
    }
    if (activity.daysSinceLastActivity !== null) {
      activityParts.push(`Last activity was ${activity.daysSinceLastActivity} day(s) ago.`);
    }
  }

  const riskParts: string[] = [];
  riskParts.push(
    `The agent carries ${money(exposure.totalDebtUsd)} of debt against ` +
    `${money(exposure.totalCreditLimitUsd)} of limits (${exposure.utilizationRatePct}% utilisation), ` +
    `leaving ${money(exposure.availableCreditUsd)} available.`,
  );
  if (exposure.openDelinquencies > 0) {
    riskParts.push(
      `${exposure.openDelinquencies} delinquenc${exposure.openDelinquencies === 1 ? 'y is' : 'ies are'} unresolved` +
      (exposure.worstDelinquencyDaysLate !== null ? `, the worst ${exposure.worstDelinquencyDaysLate} days late.` : '.'),
    );
  } else {
    riskParts.push('No delinquencies are currently unresolved.');
  }
  riskParts.push(
    evidence.compliance.sanctionsClear
      ? `Sanctions screening is clear (checks performed: ${evidence.compliance.sanctionsChecksPerformed.join(', ')}).`
      : `Sanctions screening did not clear: ${evidence.compliance.sanctionsDetail}`,
  );
  riskParts.push(
    `This assessment rests on a ${suff.level.replace(/_/g, ' ')} — ${suff.eventCount} record(s) ` +
    `from ${suff.furnisherCount} furnisher(s) over ${suff.monthsOfHistory.toFixed(1)} month(s).` +
    (suff.caveats.length > 0 ? ` ${suff.caveats.join(' ')}` : ''),
  );

  const topNegatives = decision.reasonCodes.filter(r => r.polarity === 'negative').slice(0, 3);
  const recommendationParts: string[] = [
    `${OUTCOME_PHRASE[decision.outcome]}.`,
  ];
  if (decision.conditions.length > 0) {
    recommendationParts.push(`Conditions: ${decision.conditions.join(' ')}`);
  }
  if (topNegatives.length > 0) {
    recommendationParts.push(
      `Principal concerns: ${topNegatives.map(r => r.statement).join(' ')}`,
    );
  }

  const narrative: LenderReportNarrative = {
    headline,
    summary: summaryParts.join(' '),
    activity: activityParts.join(' '),
    risk: riskParts.join(' '),
    recommendation: recommendationParts.join(' '),
  };

  if (decision.outcome === 'decline') {
    const cited = decision.adverseActionCodes
      .map(code => decision.reasonCodes.find(r => r.code === code)?.statement)
      .filter((s): s is string => !!s);

    if (decision.declineBasis === 'compliance' || cited.length === 0) {
      // Stated as what it is. Reporting an incidental credit weakness here
      // would tell the applicant the wrong thing about why they were refused.
      narrative.adverseAction =
        `This application was declined on compliance grounds, not on credit grounds. ` +
        `${decision.adjustmentReason ?? ''} `.trim() +
        ' No borrower-attributable adverse-action reason applies; the decline rests on a ' +
        'compliance or data condition, which must be stated as such rather than as a credit reason.';
    } else {
      narrative.adverseAction =
        `This application was declined. The principal reasons were: ${cited.join(' ')} ` +
        'The applicant may request a copy of the underlying report and dispute any record it contains.';
    }
  }

  return narrative;
}

// ── Human rendering ───────────────────────────────────────────────────────────

/**
 * Render the report as Markdown for a human reader.
 *
 * Served on the same route under `Accept: text/markdown`, from the same report
 * object — so the document a credit officer signs off and the JSON an
 * autonomous underwriter consumed are provably the same assessment.
 */
export function renderLenderReportMarkdown(report: LenderReport): string {
  const { decision, activity, exposure, evidence, narrative, disclosures } = report;
  const suff = evidence.dataSufficiency;
  const L: string[] = [];

  L.push(`# Credit Report — ${report.agentId}`);
  L.push('');
  L.push(`**${narrative.headline}**`);
  L.push('');
  L.push(`| | |`);
  L.push(`|---|---|`);
  L.push(`| Agent | \`${report.agentId}\` |`);
  L.push(`| DID | \`${report.did}\` |`);
  L.push(`| Prepared for | ${report.requestorName} (\`${report.requestorId}\`) |`);
  L.push(`| Purpose | ${report.purpose.replace(/_/g, ' ')} |`);
  L.push(`| Generated | ${report.generatedAt} |`);
  L.push(`| Expires | ${report.expiresAt} (${disclosures.expiresInDays} days) |`);
  L.push(`| Report ID | \`${report.reportId}\` |`);
  L.push('');

  L.push('## Decision');
  L.push('');
  L.push(`**${OUTCOME_PHRASE[decision.outcome]}** · Score **${decision.score}**/1000 · Grade **${decision.grade}** · ${decision.riskLevel} risk · **${decision.confidence}** confidence`);
  L.push('');
  L.push(narrative.summary);
  if (decision.maxRecommendedLimitUsd > 0) {
    L.push('');
    L.push(`Recommended maximum exposure: **${money(decision.maxRecommendedLimitUsd)}**`);
  }
  if (decision.conditions.length > 0) {
    L.push('');
    L.push('**Conditions**');
    L.push('');
    for (const c of decision.conditions) L.push(`- ${c}`);
  }
  L.push('');

  L.push('## Why — ranked reasons');
  L.push('');
  L.push('| Code | Effect | Weight | Reason |');
  L.push('|---|---|---|---|');
  for (const r of decision.reasonCodes) {
    const mark = r.polarity === 'positive' ? '＋' : r.polarity === 'negative' ? '−' : '·';
    L.push(`| \`${r.code}\` | ${mark} | ${r.weight} | ${r.statement} |`);
  }
  L.push('');

  L.push('## Activity');
  L.push('');
  L.push(narrative.activity);
  L.push('');
  L.push('| Window | Events | Volume | On-time | Late | Defaults | New lines |');
  L.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const [label, w] of [
    ['Last 30 days', activity.windows.last30d],
    ['Last 90 days', activity.windows.last90d],
    ['Last 365 days', activity.windows.last365d],
    ['All time', activity.windows.allTime],
  ] as const) {
    L.push(`| ${label} | ${w.events} | ${money(w.volumeUsd)} | ${w.onTimePayments} | ${w.latePayments} | ${w.defaults} | ${w.newCreditLines} |`);
  }
  L.push('');
  L.push(`Trend: **${activity.trend.replace(/_/g, ' ')}** · Account age: ${activity.accountAgeMonths} months · Hard inquiries: ${activity.inquiryVelocity.last30d} in 30d, ${activity.inquiryVelocity.last90d} in 90d`);
  L.push('');

  L.push('## Exposure');
  L.push('');
  L.push(narrative.risk);
  L.push('');
  L.push('| | |');
  L.push('|---|---:|');
  L.push(`| Current debt | ${money(exposure.totalDebtUsd)} |`);
  L.push(`| Total limits | ${money(exposure.totalCreditLimitUsd)} |`);
  L.push(`| Available | ${money(exposure.availableCreditUsd)} |`);
  L.push(`| Utilisation | ${exposure.utilizationRatePct}% |`);
  L.push(`| Open delinquencies | ${exposure.openDelinquencies} |`);
  L.push(`| Headroom vs recommended | ${money(exposure.headroomVsRecommendedUsd)} |`);
  L.push('');

  L.push('## Evidence');
  L.push('');
  L.push(`**Data sufficiency** — ${suff.level.replace(/_/g, ' ')}, ${suff.confidence} confidence. ${suff.eventCount} record(s) from ${suff.furnisherCount} furnisher(s) over ${suff.monthsOfHistory.toFixed(1)} month(s).`);
  if (suff.caveats.length > 0) {
    L.push('');
    for (const c of suff.caveats) L.push(`- ${c}`);
  }
  L.push('');
  L.push(`**Compliance** — sanctions ${evidence.compliance.sanctionsClear ? 'clear' : 'NOT clear'}; screens performed: ${evidence.compliance.sanctionsChecksPerformed.join(', ')}. Identity ${evidence.compliance.identityVerified ? 'verified' : 'NOT verified'}. ${evidence.compliance.sanctionsDetail}`);
  L.push('');
  if (evidence.furnishers.length > 0) {
    L.push('**Data furnishers**');
    L.push('');
    L.push('| Furnisher | Records |');
    L.push('|---|---:|');
    for (const f of evidence.furnishers) L.push(`| ${f.name} (\`${f.contributorId}\`) | ${f.recordsContributed} |`);
  } else {
    L.push('**Data furnishers** — none of the records on file carry furnisher attribution.');
  }
  L.push('');

  L.push('## Recommendation');
  L.push('');
  L.push(narrative.recommendation);
  if (narrative.adverseAction) {
    L.push('');
    L.push('### Adverse action notice');
    L.push('');
    L.push(narrative.adverseAction);
    if (decision.adverseActionCodes.length > 0) {
      L.push('');
      L.push(`Reason codes: ${decision.adverseActionCodes.map(c => `\`${c}\``).join(', ')}`);
    }
  }
  L.push('');

  L.push('---');
  L.push('');
  L.push(`*Score basis: ${disclosures.scoreBasis}*`);
  L.push('');
  L.push(`*${disclosures.limitations}*`);
  L.push('');
  L.push(`*${disclosures.disputeRights}*`);
  L.push('');
  L.push(`*Inquiry fee: ${money(disclosures.inquiryFeeUsd)}. Hard inquiry recorded on the agent's file: ${disclosures.inquiryRecorded ? 'yes' : 'no'}. Schema: \`${report.schemaVersion}\`.*`);

  return L.join('\n');
}

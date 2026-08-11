/**
 * Dispute resolution.
 *
 * `PUT /v1/disputes/:disputeId` used to update only `status`/`resolution` on
 * the dispute record itself. A `resolved_corrected` or `resolved_deleted`
 * outcome never touched `profile.creditHistory` and never recomputed the
 * score — the disputed event survived its own deletion, and a lender pulling
 * the report a minute after "resolution" saw the exact data the agent had
 * just disputed and won.
 *
 * This module makes resolution actually mutate the record it resolves, routed
 * back through `deriveScoreFields` (the single source of truth introduced for
 * the score-consistency fix) so the recomputed score can never drift from what
 * the scorer would return standalone.
 *
 * It also derives `furnisherId` from the disputed event's `contributorId`
 * rather than trusting the filer — the same "server-set, not caller-supplied"
 * rule applied to `creditorId` on ingest. Without it, a dispute could name the
 * wrong furnisher (or none), which is exactly the information a real
 * resolution needs to notify the furnisher that supplied the bad data. No
 * outbound notification transport exists in this service yet — there is no
 * established webhook/email path to a furnisher anywhere in the codebase — so
 * this makes the *information* correct and logs it structuredly; delivering it
 * is future work, not simulated here.
 */

import type { AgentCreditProfile, CreditEvent, CreditEventType, Dispute, DisputeStatus } from './types';
import { deriveScoreFields } from './store';

// ── Escalation ────────────────────────────────────────────────────────────────

export const DISPUTE_ESCALATION_DAYS = 30;
const DISPUTE_ESCALATION_MS = DISPUTE_ESCALATION_DAYS * 24 * 60 * 60 * 1000;

/** True when a still-open dispute has passed the 30-day FCRA-style deadline. */
export function isPastEscalationDeadline(dispute: Dispute, nowMs: number = Date.now()): boolean {
  if (dispute.status !== 'open' && dispute.status !== 'investigating') return false;
  if (dispute.escalatedAt) return false;
  return nowMs - Date.parse(dispute.filedAt) > DISPUTE_ESCALATION_MS;
}

/**
 * Stamp `escalatedAt` on a dispute that has passed its deadline. Pure — the
 * caller persists the result if it differs from the input. Previously nothing
 * anywhere ever wrote this field despite the type documenting it since the
 * type was introduced.
 */
export function withEscalationCheck(dispute: Dispute, nowMs: number = Date.now()): Dispute {
  if (!isPastEscalationDeadline(dispute, nowMs)) return dispute;
  return { ...dispute, escalatedAt: new Date(nowMs).toISOString() };
}

// ── Furnisher attribution ──────────────────────────────────────────────────────

/**
 * The furnisher that supplied the disputed event, from the event's own
 * provenance — not from whatever the filer claims. `contributorId` is only
 * present on events written after the 1b furnisher pipeline; older/legacy
 * events resolve to `undefined`, which the caller should treat as
 * "furnisher unknown" rather than guess.
 */
export function furnisherForEvent(event: CreditEvent | undefined): string | undefined {
  return event?.contributorId;
}

// ── Resolution ────────────────────────────────────────────────────────────────

/** Fields a furnisher/arbitrator supplies to correct a disputed event in place. */
export interface DisputeCorrection {
  eventType?: CreditEventType;
  amount?: number;
  description?: string;
}

export interface ResolveDisputeInput {
  profile: AgentCreditProfile;
  dispute: Dispute;
  status: DisputeStatus;
  resolution?: string;
  correction?: DisputeCorrection;
  nowMs?: number;
}

export type ResolveDisputeError =
  | 'already_resolved'
  | 'event_not_found'
  | 'correction_required';

export type ResolveDisputeResult =
  | { ok: true; profile: AgentCreditProfile; dispute: Dispute; historyChanged: boolean }
  | { ok: false; error: ResolveDisputeError; message: string };

/**
 * Apply a resolution to a dispute and, when the outcome says the record was
 * wrong, to the credit history it disputed.
 *
 *   resolved_upheld     — furnisher's data stands. No history change.
 *   resolved_corrected  — the event is updated in place with `correction`,
 *                          which is required: an arbitrator must say what
 *                          changed, not just that something did.
 *   resolved_deleted    — the disputed event is removed from history.
 *   investigating       — status only; no history change, no resolvedAt.
 *
 * Either resolving outcome re-derives the profile through `deriveScoreFields`,
 * so `currentScore`/`tier`/`scoreFactors` can never disagree with a live
 * recompute over the corrected history — the same invariant the bureau's
 * score-consistency fix established for ingest.
 */
export function resolveDispute(input: ResolveDisputeInput): ResolveDisputeResult {
  const { profile, dispute, status, resolution, correction } = input;
  const nowMs = input.nowMs ?? Date.now();

  if (dispute.status.startsWith('resolved_')) {
    return {
      ok: false,
      error: 'already_resolved',
      message: `Dispute ${dispute.id} was already resolved as ${dispute.status} at ${dispute.resolvedAt}. ` +
               'File a new dispute to contest a resolution.',
    };
  }

  const isResolving = status.startsWith('resolved_');
  const nowIso = new Date(nowMs).toISOString();

  const baseDispute: Dispute = {
    ...dispute,
    status,
    resolution,
    resolvedAt: isResolving ? nowIso : undefined,
  };

  if (!isResolving) {
    // 'investigating' — status only.
    return { ok: true, profile, dispute: baseDispute, historyChanged: false };
  }

  if (status === 'resolved_upheld') {
    return { ok: true, profile, dispute: baseDispute, historyChanged: false };
  }

  const eventIndex = profile.creditHistory.findIndex(e => e.id === dispute.eventId);
  if (eventIndex === -1) {
    return {
      ok: false,
      error: 'event_not_found',
      message: `Disputed event ${dispute.eventId} is not on agent ${dispute.agentId}'s credit history — ` +
               'it may already have been removed by a prior resolution.',
    };
  }

  let newHistory: CreditEvent[];

  if (status === 'resolved_deleted') {
    newHistory = profile.creditHistory.filter((_, i) => i !== eventIndex);
  } else {
    // resolved_corrected
    if (!correction || Object.keys(correction).length === 0) {
      return {
        ok: false,
        error: 'correction_required',
        message: 'resolved_corrected requires a `correction` describing what changed on the disputed event ' +
                 '— an arbitrator must state the correct facts, not just that the original was wrong.',
      };
    }
    newHistory = profile.creditHistory.map((e, i) => (i === eventIndex ? { ...e, ...correction } : e));
  }

  const rederived = deriveScoreFields({
    ...profile,
    creditHistory: newHistory,
    lastUpdatedAt: nowIso,
  });

  return { ok: true, profile: rederived, dispute: baseDispute, historyChanged: true };
}

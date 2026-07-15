/**
 * ForgePay Agent Credit Bureau — Agent Verification
 * ──────────────────────────────────────────────────
 * 8-check agent verification, absorbed from CREDITTIME (Qova) agent-verify
 * and rewired to run off the bureau's own credit profiles instead of
 * on-chain contract reads. Returns VERIFIED / PARTIALLY_VERIFIED /
 * UNVERIFIED / SUSPICIOUS plus the AAA–D credit grade.
 *
 * Checks:
 *   1. registration          — agent has a bureau credit profile
 *   2. identity_bound        — did:forge bound to a legal operator entity
 *   3. account_age           — ≥ 3 months of history
 *   4. operator_consistency  — operator entity type on record, profile not frozen
 *   5. activity_level        — ≥ 5 credit events recorded
 *   6. history_stability     — no open delinquencies, no defaults on record
 *   7. sanctions_screen      — no sanctions hits, profile not frozen
 *   8. minimum_score         — score ≥ 500 (above DEEP_SUBPRIME floor)
 */

import type { AgentCreditProfile } from './types';
import { creditGrade, type CreditGrade } from './grade';

export type VerificationStatus =
  | 'VERIFIED'
  | 'PARTIALLY_VERIFIED'
  | 'UNVERIFIED'
  | 'SUSPICIOUS';

export interface VerificationCheck {
  check: string;
  passed: boolean;
  detail: string;
}

export interface VerificationResult {
  agentId: string;
  did: string;
  status: VerificationStatus;
  checksPassed: number;
  checksTotal: number;
  checks: VerificationCheck[];
  score: number;
  grade: CreditGrade;
  verifiedAt: string;
}

export interface SanctionsResult {
  agentId: string;
  clear: boolean;
  hits: number;
  frozen: boolean;
  detail: string;
  screenedAt: string;
}

const MIN_SCORE       = 500;
const MIN_AGE_MONTHS  = 3;
const MIN_EVENTS      = 5;

export function sanctionsScreen(profile: AgentCreditProfile): SanctionsResult {
  const hits = profile.creditHistory.filter(e => e.eventType === 'sanctions_hit').length;
  const frozen = !!profile.frozenAt;
  const clear = hits === 0 && !frozen;
  return {
    agentId: profile.agentId,
    clear,
    hits,
    frozen,
    detail: clear
      ? 'No sanctions hits on record; profile active.'
      : frozen
        ? `Profile frozen since ${profile.frozenAt} — legal hold or sanctions exposure.`
        : `${hits} sanctions hit(s) recorded in credit history.`,
    screenedAt: new Date().toISOString(),
  };
}

export function verifyAgent(profile: AgentCreditProfile): VerificationResult {
  const ageMonths = Math.max(0,
    (Date.now() - new Date(profile.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44),
  );
  const openDelinquencies = profile.delinquencies.filter(d => d.status === 'open').length;
  const hasDefault = profile.creditHistory.some(e => e.eventType === 'default');
  const identityVerified = profile.operatorEntityId.length > 0 &&
    (profile.creditHistory.some(e => e.eventType === 'identity_verified') || profile.did.startsWith('did:'));
  const sanctions = sanctionsScreen(profile);

  const checks: VerificationCheck[] = [
    {
      check: 'registration',
      passed: true,
      detail: `Registered with the bureau since ${profile.createdAt.slice(0, 10)}.`,
    },
    {
      check: 'identity_bound',
      passed: identityVerified,
      detail: identityVerified
        ? `${profile.did} bound to operator entity ${profile.operatorEntityId} (${profile.operatorEntityType}).`
        : 'DID is not bound to a verified legal operator entity.',
    },
    {
      check: 'account_age',
      passed: ageMonths >= MIN_AGE_MONTHS,
      detail: `${Math.round(ageMonths)} month(s) of history (minimum ${MIN_AGE_MONTHS}).`,
    },
    {
      check: 'operator_consistency',
      passed: !!profile.operatorEntityType && !profile.frozenAt,
      detail: profile.frozenAt
        ? 'Profile frozen — operator standing cannot be confirmed.'
        : `Operator entity type on record: ${profile.operatorEntityType}.`,
    },
    {
      check: 'activity_level',
      passed: profile.creditHistory.length >= MIN_EVENTS,
      detail: `${profile.creditHistory.length} credit event(s) recorded (minimum ${MIN_EVENTS}).`,
    },
    {
      check: 'history_stability',
      passed: openDelinquencies === 0 && !hasDefault,
      detail: hasDefault
        ? 'Default on record.'
        : openDelinquencies > 0
          ? `${openDelinquencies} open delinquenc${openDelinquencies === 1 ? 'y' : 'ies'}.`
          : 'No open delinquencies or defaults.',
    },
    {
      check: 'sanctions_screen',
      passed: sanctions.clear,
      detail: sanctions.detail,
    },
    {
      check: 'minimum_score',
      passed: profile.currentScore >= MIN_SCORE,
      detail: `Score ${profile.currentScore} (minimum ${MIN_SCORE}).`,
    },
  ];

  const checksPassed = checks.filter(c => c.passed).length;

  let status: VerificationStatus;
  if (!sanctions.clear) status = 'SUSPICIOUS';
  else if (checksPassed === checks.length) status = 'VERIFIED';
  else if (checksPassed >= 6) status = 'PARTIALLY_VERIFIED';
  else status = 'UNVERIFIED';

  return {
    agentId:      profile.agentId,
    did:          profile.did,
    status,
    checksPassed,
    checksTotal:  checks.length,
    checks,
    score:        profile.currentScore,
    grade:        creditGrade(profile.currentScore),
    verifiedAt:   new Date().toISOString(),
  };
}

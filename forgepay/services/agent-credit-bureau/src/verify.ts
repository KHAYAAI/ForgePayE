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
import { screenAddress, screenEntity, type ScreenOutcome } from './sanctions';
import { checkAgentIdentity } from './identity';

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
  /**
   * What was actually checked. `local` (recorded events + frozen status) runs
   * unconditionally. `address`/`entity` are real compliance-monitor checks
   * against the OFAC/EU lists, present only when the profile carries the data
   * they need (evmAddress / operatorLegalName) and the service is configured.
   * A caller reading only `clear` cannot tell a real screen from an absent
   * one — this says which happened.
   */
  checked: Array<'local' | 'address' | 'entity'>;
  addressScreen?: ScreenOutcome;
  entityScreen?: ScreenOutcome;
}

const MIN_SCORE       = 500;
const MIN_AGE_MONTHS  = 3;
const MIN_EVENTS      = 5;

export async function sanctionsScreen(profile: AgentCreditProfile): Promise<SanctionsResult> {
  // Local signal — self-reported/ops-recorded, not a list check. Kept because
  // it is still real evidence (e.g. an operator manually confirming a hit),
  // just never sufficient on its own; that was the entire bug.
  const hits = profile.creditHistory.filter(e => e.eventType === 'sanctions_hit').length;
  const frozen = !!profile.frozenAt;
  const checked: Array<'local' | 'address' | 'entity'> = ['local'];

  // Real checks — only run against data the profile actually carries.
  const addressScreen = profile.evmAddress
    ? await screenAddress(profile.evmAddress)
    : undefined;
  if (addressScreen) checked.push('address');

  const entityScreen = profile.operatorLegalName
    ? await screenEntity(
        profile.agentId,
        profile.operatorEntityType === 'individual' ? 'person' : 'business',
        profile.operatorLegalName,
      )
    : undefined;
  if (entityScreen) checked.push('entity');

  // Clear only if every signal checked is clear. A `not_configured_prod` or
  // `call_failed` outcome is not clear — an unreachable screening service is
  // not evidence of a clean agent.
  const clear =
    hits === 0 && !frozen &&
    (addressScreen ? addressScreen.clear : true) &&
    (entityScreen ? entityScreen.clear : true);

  const parts: string[] = [];
  if (hits > 0) parts.push(`${hits} sanctions hit(s) recorded in credit history`);
  if (frozen) parts.push(`profile frozen since ${profile.frozenAt}`);
  if (addressScreen && !addressScreen.clear) {
    parts.push(addressScreen.checked
      ? `on-chain address flagged (${addressScreen.result.result}, ${addressScreen.result.recommended_action})`
      : `address screen unavailable (${addressScreen.reason})`);
  }
  if (entityScreen && !entityScreen.clear) {
    parts.push(entityScreen.checked
      ? `operator entity flagged (${entityScreen.result.result}, ${entityScreen.result.recommended_action})`
      : `entity screen unavailable (${entityScreen.reason})`);
  }
  const uncheckedNote = checked.length === 1
    ? ' No evmAddress or operatorLegalName on file — only the local record was checked.'
    : '';

  return {
    agentId: profile.agentId,
    clear,
    hits,
    frozen,
    checked,
    addressScreen,
    entityScreen,
    detail: clear
      ? `Clear on all ${checked.length} check(s) performed (${checked.join(', ')}).${uncheckedNote}`
      : parts.join('; ') + '.',
    screenedAt: new Date().toISOString(),
  };
}

export async function verifyAgent(profile: AgentCreditProfile): Promise<VerificationResult> {
  const ageMonths = Math.max(0,
    (Date.now() - new Date(profile.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44),
  );
  const openDelinquencies = profile.delinquencies.filter(d => d.status === 'open').length;
  const hasDefault = profile.creditHistory.some(e => e.eventType === 'default');

  // Local heuristic — shape checks on data the bureau itself already trusts,
  // not evidence of anything agent-identity confirms. Kept as the fallback
  // for address-form DIDs (never registered there by design) and for when
  // agent-identity is unreachable, so a network blip doesn't turn every
  // verification unreachably UNVERIFIED.
  const localHeuristic = profile.operatorEntityId.length > 0 &&
    (profile.creditHistory.some(e => e.eventType === 'identity_verified') || profile.did.startsWith('did:'));

  const identityCheck = await checkAgentIdentity(profile.did);
  let identityVerified: boolean;
  let identityDetail: string;
  if (identityCheck.checked && identityCheck.found) {
    // A real answer from the registry overrides the heuristic in both
    // directions: confirmed-active passes even if local data was thin;
    // confirmed-inactive fails even if it looked plausible locally.
    identityVerified = identityCheck.active;
    identityDetail = identityVerified
      ? `${profile.did} confirmed active in the agent-identity registry.`
      : `${profile.did} found in the agent-identity registry but status is not active.`;
  } else if (identityCheck.checked && !identityCheck.found) {
    identityVerified = false;
    identityDetail = `${profile.did} is a registry-form DID but has no matching record in agent-identity.`;
  } else {
    identityVerified = localHeuristic;
    const why = identityCheck.reason === 'not_registry_form'
      ? 'address-form DID, not issued by agent-identity'
      : 'agent-identity unreachable';
    identityDetail = identityVerified
      ? `${profile.did} bound to operator entity ${profile.operatorEntityId} (${profile.operatorEntityType}). Unverified against agent-identity (${why}).`
      : `DID is not bound to a verified legal operator entity. Unverified against agent-identity (${why}).`;
  }

  const sanctions = await sanctionsScreen(profile);

  const checks: VerificationCheck[] = [
    {
      check: 'registration',
      passed: true,
      detail: `Registered with the bureau since ${profile.createdAt.slice(0, 10)}.`,
    },
    {
      check: 'identity_bound',
      passed: identityVerified,
      detail: identityDetail,
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

/**
 * Operator verification — proving a Controller is a real registered company.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The gap this closes
 *
 * `operatorEntityId` ("EIN/VAT/TRN") and `operatorLegalName` are free text and
 * always have been. Nothing has ever checked either against a company
 * register, so "this agent is operated by Acme (Pty) Ltd, registration
 * 2019/123456/07" has exactly as much standing as a caller typing anything
 * else into the field. Every downstream consumer — a lender pulling a report,
 * a settlement paying out — has been trusting an unverified assertion.
 *
 * That matters beyond data quality. The bureau's position on consumer-credit
 * regulation (see docs/LAUNCH_RUNBOOK.md Step 1) rests on operators being
 * juristic persons rather than natural ones. A policy of "juristic operators
 * only" enforced by an unvalidated enum is not a policy; it is a text field
 * that happens to say 'llc'. This module is what makes the distinction real.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two halves, deliberately separated
 *
 *   - A provider seam (`KybProvider`) that answers "what does the register say
 *     about this company", and reports outages as outages.
 *   - A policy (`operatorEligibility`) that decides what a given answer means
 *     for whether this operator may hold credit.
 *
 * They are split because the right response to "the register is down" is a
 * policy question, not a provider one, and because the provider is the part
 * that gets swapped when the vendor changes.
 *
 * Nothing here freezes, refuses or charges anything by itself. Callers apply
 * the decision; this module only computes it.
 */

import type {
  AgentCreditProfile, OperatorVerification, OperatorVerificationStatus,
} from './types';

// ── Which operator types a register can speak to ─────────────────────────────

/**
 * Entity types that a company register can actually confirm.
 *
 * `individual` is excluded because a natural person is not in a company
 * register — verifying one is KYC, a different product and a different legal
 * posture. `dao` is excluded because an unincorporated DAO has no registration
 * to look up; a DAO that *is* incorporated (a Wyoming DAO LLC, a Marshall
 * Islands DAO) should register here as the corporate form it legally took, not
 * as 'dao'. Both exclusions are deliberate and both are load-bearing for the
 * policy below.
 */
const REGISTRY_VERIFIABLE_TYPES = new Set(['llc', 'corp']);

export function isRegistryVerifiable(entityType: string): boolean {
  return REGISTRY_VERIFIABLE_TYPES.has(entityType);
}

// ── Provider seam ────────────────────────────────────────────────────────────

export interface KybQuery {
  /** ISO 3166-1 alpha-2. A register is per-country; without this there is no lookup. */
  countryCode: string;
  legalName?: string;
  registrationNumber?: string;
}

export interface KybProvider {
  name: string;
  lookup(query: KybQuery): Promise<OperatorVerification>;
}

/**
 * The default provider: answers "I could not ask".
 *
 * Deliberately not a throw and deliberately not a pass. `registry_unavailable`
 * is a real, retryable state that the policy already has to handle for a
 * provider outage, so an unconfigured bureau lands in the same branch as a
 * temporarily broken one rather than in a special case of its own.
 *
 * Whether that state blocks an operator is `operatorEligibility`'s decision,
 * not this class's — which is why this does not consult NODE_ENV.
 */
export class UnconfiguredKybProvider implements KybProvider {
  name = 'unconfigured';

  async lookup(_query: KybQuery): Promise<OperatorVerification> {
    return {
      status: 'registry_unavailable',
      checkedAt: new Date().toISOString(),
      provider: this.name,
    };
  }
}

let provider: KybProvider = new UnconfiguredKybProvider();

/** Swap the provider — used by tests, and by a real vendor integration. */
export function setKybProvider(next: KybProvider): void {
  provider = next;
}

export function currentKybProvider(): KybProvider {
  return provider;
}

// ── Running a verification ───────────────────────────────────────────────────

export type VerifyOperatorRefusal =
  | 'not_registry_verifiable'
  | 'jurisdiction_missing'
  | 'nothing_to_search';

export type VerifyOperatorOutcome =
  | { ok: true; verification: OperatorVerification }
  | { ok: false; reason: VerifyOperatorRefusal; message: string };

/**
 * Ask the register about this profile's operator.
 *
 * Returns the verification record for the caller to persist. Refuses, without
 * calling the provider, in the cases where a lookup is not a meaningful thing
 * to attempt — a natural person, a missing jurisdiction, or no name and no
 * number to search on. Those refusals are distinct from anything the register
 * might say, because they are about our own record being unusable rather than
 * about the company.
 */
export async function verifyOperator(profile: AgentCreditProfile): Promise<VerifyOperatorOutcome> {
  if (!isRegistryVerifiable(profile.operatorEntityType)) {
    return {
      ok: false,
      reason: 'not_registry_verifiable',
      message:
        `Operator entity type '${profile.operatorEntityType}' cannot be verified against a ` +
        'company register. Only llc and corp can; individual is a KYC question and an ' +
        'unincorporated dao has no registration to look up.',
    };
  }

  if (!profile.operatorCountry) {
    return {
      ok: false,
      reason: 'jurisdiction_missing',
      message:
        'operatorCountry is not set. A company register is per-country, so there is no ' +
        'register to ask. Set it to the ISO 3166-1 alpha-2 country of registration.',
    };
  }

  if (!profile.operatorLegalName && !profile.operatorRegistrationNumber) {
    return {
      ok: false,
      reason: 'nothing_to_search',
      message:
        'Neither operatorLegalName nor operatorRegistrationNumber is set — there is nothing ' +
        'to search the register on. operatorEntityId is the bureau\'s own handle and is not ' +
        'a registry key.',
    };
  }

  const verification = await provider.lookup({
    countryCode: profile.operatorCountry,
    ...(profile.operatorLegalName ? { legalName: profile.operatorLegalName } : {}),
    ...(profile.operatorRegistrationNumber
      ? { registrationNumber: profile.operatorRegistrationNumber }
      : {}),
  });

  return { ok: true, verification };
}

// ── Policy ───────────────────────────────────────────────────────────────────

/**
 * Whether the bureau is restricted to juristic operators.
 *
 * Exact-string `'true'`, matching PAYOUT_SIGNER_ENABLED in stablecoin-gateway:
 * '1', 'yes' and 'TRUE' all mean off. A control this consequential should be
 * switched on by someone who meant to, not by a truthy-looking value.
 *
 * Default off, so existing deployments keep behaving exactly as before until
 * the policy is deliberately adopted.
 */
export function juristicOperatorsOnly(): boolean {
  return process.env['JURISTIC_OPERATORS_ONLY'] === 'true';
}

export type OperatorRefusal =
  | 'individual_operator_refused'
  | 'not_registry_verifiable'
  | 'jurisdiction_missing'
  | 'verification_required'
  | 'registry_says_not_found'
  | 'registry_says_inactive'
  | 'registry_unavailable';

export interface OperatorEligibility {
  allowed: boolean;
  reason?: OperatorRefusal;
  detail: string;
  /**
   * True when the refusal may resolve on its own (an outage, a pending
   * check) rather than being a property of the operator. Callers can use it
   * to decide between "come back later" and "you cannot onboard".
   */
  retryable?: boolean;
}

/**
 * Decide whether this operator may hold credit with the bureau.
 *
 * With the policy off this always allows, including for operators with no
 * verification record at all — the pre-existing behaviour, unchanged.
 *
 * With it on, the ordering matters: the entity-type refusals come first
 * because they are permanent and cheap to state, and no amount of registry
 * evidence changes them. A missing verification is refused rather than
 * treated as clean, since "we never asked" and "we asked and it was fine" are
 * the two states this whole module exists to stop conflating.
 */
export function operatorEligibility(profile: AgentCreditProfile): OperatorEligibility {
  if (!juristicOperatorsOnly()) {
    return {
      allowed: true,
      detail: 'JURISTIC_OPERATORS_ONLY is not enabled — operator type and registration are not gated.',
    };
  }

  if (profile.operatorEntityType === 'individual') {
    return {
      allowed: false,
      reason: 'individual_operator_refused',
      detail:
        'This bureau accepts juristic operators only. An agent operated by a natural person ' +
        'cannot be onboarded while JURISTIC_OPERATORS_ONLY is enabled.',
    };
  }

  if (!isRegistryVerifiable(profile.operatorEntityType)) {
    return {
      allowed: false,
      reason: 'not_registry_verifiable',
      detail:
        `Operator entity type '${profile.operatorEntityType}' has no company registration to ` +
        'verify. An incorporated DAO should be registered as the corporate form it legally ' +
        'took (llc or corp), naming the jurisdiction that incorporated it.',
    };
  }

  if (!profile.operatorCountry) {
    return {
      allowed: false,
      reason: 'jurisdiction_missing',
      detail: 'operatorCountry is not set, so the operator cannot be verified against any register.',
    };
  }

  const v = profile.operatorVerification;
  if (!v) {
    return {
      allowed: false,
      reason: 'verification_required',
      detail: 'The operator has never been checked against a company register.',
      retryable: true,
    };
  }

  const byStatus: Record<OperatorVerificationStatus, OperatorEligibility> = {
    verified: {
      allowed: true,
      detail:
        `Operator verified against ${v.registry ?? 'a company register'} as ` +
        `${v.registeredName ?? profile.operatorLegalName ?? 'a registered company'}` +
        `${v.registrationNumber ? ` (${v.registrationNumber})` : ''} on ${v.checkedAt.slice(0, 10)}.`,
    },
    not_found: {
      allowed: false,
      reason: 'registry_says_not_found',
      detail:
        `${v.registry ?? 'The company register'} holds no company matching this operator ` +
        `(checked ${v.checkedAt.slice(0, 10)}).`,
    },
    inactive: {
      allowed: false,
      reason: 'registry_says_inactive',
      detail:
        `${v.registry ?? 'The company register'} lists this operator as not in good standing` +
        `${v.registryStatus ? ` (${v.registryStatus})` : ''}.`,
    },
    registry_unavailable: {
      allowed: false,
      reason: 'registry_unavailable',
      detail:
        'The company register could not be reached, so the operator is unverified. This is ' +
        'an outage rather than a finding — retry before treating it as a rejection.',
      retryable: true,
    },
  };

  return byStatus[v.status];
}

/**
 * Operator verification: what must not happen.
 *
 * The assertions that matter here are the ones about not conflating states.
 * "Never asked" must not read as "asked and it was fine". A register outage
 * must not read as a rejection of the company. And a policy that exists to
 * keep natural persons out must not be satisfiable by typing 'llc' into a
 * text field.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  operatorEligibility, verifyOperator, isRegistryVerifiable,
  juristicOperatorsOnly, setKybProvider, currentKybProvider,
  UnconfiguredKybProvider, type KybProvider, type KybQuery,
} from './kyb';
import type { AgentCreditProfile, OperatorVerification } from './types';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  setKybProvider(new UnconfiguredKybProvider());
  vi.restoreAllMocks();
});

function profile(over: Partial<AgentCreditProfile> = {}): AgentCreditProfile {
  return {
    agentId: 'agent_1',
    did: 'did:forge:0x1234567890123456789012345678901234567890',
    operatorEntityId: 'EIN-00-0000000',
    operatorEntityType: 'llc',
    operatorLegalName: 'Acme Trading (Pty) Ltd',
    operatorCountry: 'ZA',
    currentScore: 650,
    tier: 'PRIME',
    scoreFactors: [],
    creditHistory: [],
    totalDebt: 0,
    totalCreditLimit: 0,
    utilizationRate: 0,
    paymentHistoryRate: 1,
    delinquencies: [],
    hardInquiries: [],
    createdAt: '2026-01-01T00:00:00Z',
    lastUpdatedAt: '2026-01-01T00:00:00Z',
    ...over,
  } as AgentCreditProfile;
}

function verification(over: Partial<OperatorVerification> = {}): OperatorVerification {
  return {
    status: 'verified',
    checkedAt: '2026-09-01T00:00:00Z',
    provider: 'test',
    registry: 'CIPC',
    registeredName: 'ACME TRADING (PTY) LTD',
    registrationNumber: '2019/123456/07',
    ...over,
  };
}

/** Records what it was asked, so we can assert the query as well as the answer. */
function stubProvider(result: OperatorVerification) {
  const calls: KybQuery[] = [];
  const p: KybProvider = {
    name: 'stub',
    async lookup(q) { calls.push(q); return result; },
  };
  setKybProvider(p);
  return calls;
}

// ── The switch ────────────────────────────────────────────────────────────────

describe('juristicOperatorsOnly', () => {
  it('is off unless the value is exactly "true"', () => {
    for (const v of ['1', 'yes', 'TRUE', 'True', '', 'false']) {
      process.env['JURISTIC_OPERATORS_ONLY'] = v;
      expect(juristicOperatorsOnly()).toBe(false);
    }
    process.env['JURISTIC_OPERATORS_ONLY'] = 'true';
    expect(juristicOperatorsOnly()).toBe(true);
  });

  it('is off when unset, so an existing deployment is unaffected', () => {
    delete process.env['JURISTIC_OPERATORS_ONLY'];
    expect(juristicOperatorsOnly()).toBe(false);
    // And the gate really is inert, not merely reporting as off.
    expect(operatorEligibility(profile({ operatorEntityType: 'individual' })).allowed).toBe(true);
  });
});

// ── Which types a register can speak to ──────────────────────────────────────

describe('isRegistryVerifiable', () => {
  it('covers the incorporated forms only', () => {
    expect(isRegistryVerifiable('llc')).toBe(true);
    expect(isRegistryVerifiable('corp')).toBe(true);
    // A natural person is a KYC question, not a company register lookup.
    expect(isRegistryVerifiable('individual')).toBe(false);
    // An unincorporated DAO has no registration to look up at all.
    expect(isRegistryVerifiable('dao')).toBe(false);
  });
});

// ── The policy ───────────────────────────────────────────────────────────────

describe('operatorEligibility with the policy on', () => {
  function on() { process.env['JURISTIC_OPERATORS_ONLY'] = 'true'; }

  it('refuses a natural-person operator permanently', () => {
    on();
    const e = operatorEligibility(profile({ operatorEntityType: 'individual' }));
    expect(e.allowed).toBe(false);
    expect(e.reason).toBe('individual_operator_refused');
    // Permanent: no registry answer could change it, so onboarding must not
    // invite a retry.
    expect(e.retryable).toBeFalsy();
  });

  it('refuses a dao, because there is no registration to check', () => {
    on();
    const e = operatorEligibility(profile({ operatorEntityType: 'dao' }));
    expect(e.allowed).toBe(false);
    expect(e.reason).toBe('not_registry_verifiable');
    expect(e.retryable).toBeFalsy();
  });

  it('refuses when no jurisdiction is on file', () => {
    on();
    const e = operatorEligibility(profile({ operatorCountry: undefined }));
    expect(e.allowed).toBe(false);
    expect(e.reason).toBe('jurisdiction_missing');
    expect(e.retryable).toBeFalsy();
  });

  it('refuses an operator that has never been checked', () => {
    // The central assertion of this file: absent evidence is not evidence.
    on();
    const e = operatorEligibility(profile({ operatorVerification: undefined }));
    expect(e.allowed).toBe(false);
    expect(e.reason).toBe('verification_required');
    // Retryable — the profile is fine, we just have not asked yet.
    expect(e.retryable).toBe(true);
  });

  it('allows a verified operator', () => {
    on();
    const e = operatorEligibility(profile({ operatorVerification: verification() }));
    expect(e.allowed).toBe(true);
    expect(e.detail).toContain('CIPC');
    expect(e.detail).toContain('2019/123456/07');
  });

  it('refuses one the register does not hold', () => {
    on();
    const e = operatorEligibility(profile({
      operatorVerification: verification({ status: 'not_found' }),
    }));
    expect(e.allowed).toBe(false);
    expect(e.reason).toBe('registry_says_not_found');
    expect(e.retryable).toBeFalsy();
  });

  it('refuses one the register lists as not in good standing', () => {
    on();
    const e = operatorEligibility(profile({
      operatorVerification: verification({ status: 'inactive', registryStatus: 'DEREGISTERED' }),
    }));
    expect(e.allowed).toBe(false);
    expect(e.reason).toBe('registry_says_inactive');
    expect(e.detail).toContain('DEREGISTERED');
    expect(e.retryable).toBeFalsy();
  });

  it('treats an unreachable register as retryable, not as a rejection', () => {
    // The distinction that stops an outage from permanently locking out a
    // legitimate company.
    on();
    const e = operatorEligibility(profile({
      operatorVerification: verification({ status: 'registry_unavailable' }),
    }));
    expect(e.allowed).toBe(false);
    expect(e.reason).toBe('registry_unavailable');
    expect(e.retryable).toBe(true);
  });

  it('separates permanent refusals from retryable ones, which is what the door keys on', () => {
    // POST /v1/agents/:id/profile refuses !allowed && !retryable. If that
    // split ever inverted, either every new profile would be rejected before
    // it could be verified, or a natural-person operator would be let in to
    // "retry" forever.
    on();
    const permanent = [
      profile({ operatorEntityType: 'individual' }),
      profile({ operatorEntityType: 'dao' }),
      profile({ operatorCountry: undefined }),
      profile({ operatorVerification: verification({ status: 'not_found' }) }),
      profile({ operatorVerification: verification({ status: 'inactive' }) }),
    ];
    for (const p of permanent) {
      const e = operatorEligibility(p);
      expect(e.allowed).toBe(false);
      expect(e.retryable).toBeFalsy();
    }

    const retryable = [
      profile({ operatorVerification: undefined }),
      profile({ operatorVerification: verification({ status: 'registry_unavailable' }) }),
    ];
    for (const p of retryable) {
      const e = operatorEligibility(p);
      expect(e.allowed).toBe(false);
      expect(e.retryable).toBe(true);
    }
  });
});

// ── Running a lookup ─────────────────────────────────────────────────────────

describe('verifyOperator', () => {
  it('does not call the provider for a natural person', async () => {
    const calls = stubProvider(verification());
    const out = await verifyOperator(profile({ operatorEntityType: 'individual' }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('not_registry_verifiable');
    // Not merely refused — never asked, so no fee is incurred for a lookup
    // that could not have succeeded.
    expect(calls).toHaveLength(0);
  });

  it('does not call the provider without a jurisdiction', async () => {
    const calls = stubProvider(verification());
    const out = await verifyOperator(profile({ operatorCountry: undefined }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('jurisdiction_missing');
    expect(calls).toHaveLength(0);
  });

  it('does not call the provider with nothing to search on', async () => {
    const calls = stubProvider(verification());
    const out = await verifyOperator(profile({
      operatorLegalName: undefined,
      operatorRegistrationNumber: undefined,
    }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('nothing_to_search');
    expect(calls).toHaveLength(0);
  });

  it('searches on a registration number alone, without a name', async () => {
    // operatorEntityId is the bureau's own handle and is deliberately not
    // sent — a register cannot look up an EIN we invented a format for.
    const calls = stubProvider(verification());
    const out = await verifyOperator(profile({
      operatorLegalName: undefined,
      operatorRegistrationNumber: '2019/123456/07',
    }));
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ countryCode: 'ZA', registrationNumber: '2019/123456/07' });
  });

  it('passes name and number through together when both are known', async () => {
    const calls = stubProvider(verification());
    await verifyOperator(profile({ operatorRegistrationNumber: '2019/123456/07' }));
    expect(calls[0]).toEqual({
      countryCode: 'ZA',
      legalName: 'Acme Trading (Pty) Ltd',
      registrationNumber: '2019/123456/07',
    });
  });

  it('returns whatever the register said, including a negative', async () => {
    stubProvider(verification({ status: 'not_found', registeredName: undefined }));
    const out = await verifyOperator(profile());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.verification.status).toBe('not_found');
  });
});

// ── The default provider ─────────────────────────────────────────────────────

describe('UnconfiguredKybProvider', () => {
  it('is the default', () => {
    expect(currentKybProvider().name).toBe('unconfigured');
  });

  it('reports an outage rather than throwing or passing', async () => {
    // It must not throw: a bureau with no KYB vendor still has to serve
    // traffic. It must not pass: that would make "no vendor configured" read
    // as "operator verified", which is the whole failure this module exists
    // to prevent.
    const out = await verifyOperator(profile());
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.verification.status).toBe('registry_unavailable');
      expect(out.verification.provider).toBe('unconfigured');
    }

    process.env['JURISTIC_OPERATORS_ONLY'] = 'true';
    const p = profile({ operatorVerification: (out as { verification: OperatorVerification }).verification });
    expect(operatorEligibility(p).allowed).toBe(false);
  });
});

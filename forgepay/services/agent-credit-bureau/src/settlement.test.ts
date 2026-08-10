/**
 * Settlement eligibility.
 *
 * The regression this guards: an agent whose DID did not parse was skipped on
 * every settlement run, forever, and the only trace was a string pushed into
 * `run.errors`. `/dual-score` returned a bare `mode2: null` with no way for a
 * caller to distinguish "the chain isn't configured" from "this agent can never
 * settle". Eligibility is now a structured, queryable answer.
 */
import { describe, expect, it } from 'vitest';
import { settlementEligibility } from './settlement';
import { profiles } from './store';
import { toChecksumAddress } from './did';
import type { AgentCreditProfile } from './types';

const ADDR = '0x7a3b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b';

function profile(over: Partial<AgentCreditProfile> = {}): AgentCreditProfile {
  return {
    agentId: 'agent_test',
    did: `did:forge:${ADDR}`,
    operatorEntityId: 'EIN-1',
    operatorEntityType: 'llc',
    currentScore: 700,
    tier: 'PRIME',
    scoreFactors: [],
    creditHistory: [],
    totalDebt: 0,
    totalCreditLimit: 0,
    utilizationRate: 0,
    paymentHistoryRate: 1,
    delinquencies: [],
    hardInquiries: [],
    createdAt: '2024-01-01T00:00:00Z',
    lastUpdatedAt: '2024-01-01T00:00:00Z',
    ...over,
  } as AgentCreditProfile;
}

describe('settlementEligibility', () => {
  it('resolves an address from a self-certifying DID', () => {
    const e = settlementEligibility(profile());
    expect(e.eligible).toBe(true);
    expect(e.address).toBe(toChecksumAddress(ADDR));
    expect(e.reason).toBeUndefined();
  });

  it('prefers the explicit evmAddress over the DID', () => {
    const other = '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
    expect(settlementEligibility(profile({ evmAddress: other })).address).toBe(other);
  });

  it('resolves a registry DID when an explicit address is present', () => {
    const e = settlementEligibility(profile({
      did: 'did:forge:agent_abc',
      evmAddress: toChecksumAddress(ADDR),
    }));
    expect(e.eligible).toBe(true);
    expect(e.address).toBe(toChecksumAddress(ADDR));
  });

  it('reports no_evm_address for a registry DID with no address', () => {
    const e = settlementEligibility(profile({ did: 'did:forge:agent_abc', evmAddress: undefined }));
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe('no_evm_address');
    // The detail has to tell an operator how to fix it, not just that it failed.
    expect(e.detail).toContain('agent_test');
    expect(e.detail).toContain('did:forge:0x');
  });

  it('reports an unparseable DID as ineligible rather than throwing', () => {
    const e = settlementEligibility(profile({ did: 'nonsense', evmAddress: undefined }));
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe('no_evm_address');
  });

  it('reports frozen separately from missing address, and keeps the address', () => {
    const e = settlementEligibility(profile({ frozenAt: '2024-06-16T00:00:00Z' }));
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe('frozen');
    // A frozen agent resolved fine — the block is policy, not identity.
    expect(e.address).toBe(toChecksumAddress(ADDR));
  });

  it('accepts the legacy did:fp: form', () => {
    const e = settlementEligibility(profile({ did: `did:fp:${ADDR}`, evmAddress: undefined }));
    expect(e.eligible).toBe(true);
    expect(e.address).toBe(toChecksumAddress(ADDR));
  });
});

describe('seeded profiles are settleable', () => {
  it('resolves an address for every seeded agent', () => {
    expect(profiles.size).toBeGreaterThan(0);
    for (const p of profiles.values()) {
      expect(settlementEligibility(p).address, `${p.agentId} resolved no address`).toBeTruthy();
    }
  });

  it('blocks only the deliberately frozen agent', () => {
    const blocked = [...profiles.values()]
      .map(p => ({ id: p.agentId, e: settlementEligibility(p) }))
      .filter(x => !x.e.eligible);

    // agent_deep_001 carries frozenAt in the seed data; nothing else should be
    // blocked, and nothing should ever be blocked for no_evm_address.
    expect(blocked.map(b => b.id)).toEqual(['agent_deep_001']);
    expect(blocked[0]!.e.reason).toBe('frozen');
  });
});

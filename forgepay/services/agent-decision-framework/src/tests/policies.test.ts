import { describe, it, expect, beforeEach } from 'vitest';
import {
  listPolicies,
  addPolicy,
  updatePolicy,
  deletePolicy,
  getPolicy,
  resetPolicies,
  getAgentPolicy,
  setAgentPolicy,
  clearAgentPolicies,
} from '../policies';

describe('policies store', () => {
  beforeEach(() => {
    resetPolicies();
    clearAgentPolicies();
  });

  it('seeds three default policies', () => {
    const all = listPolicies();
    expect(all).toHaveLength(3);
    expect(all.map(p => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('adds a new policy and retrieves it', () => {
    addPolicy({
      id: 'p4', name: 'velocity cap', type: 'block_velocity_exceeded',
      params: { maxDailyVolumeUsd: 1_000_000 }, enabled: true,
    });
    expect(getPolicy('p4')?.name).toBe('velocity cap');
    expect(listPolicies()).toHaveLength(4);
  });

  it('updates an existing policy preserving id', () => {
    const updated = updatePolicy('p1', { enabled: false, params: { minReputation: 20 } });
    expect(updated?.enabled).toBe(false);
    expect(updated?.params.minReputation).toBe(20);
    expect(updated?.id).toBe('p1');
  });

  it('returns null when updating an unknown policy', () => {
    expect(updatePolicy('nope', { enabled: false })).toBeNull();
  });

  it('deletes a policy and returns false on re-delete', () => {
    expect(deletePolicy('p2')).toBe(true);
    expect(getPolicy('p2')).toBeUndefined();
    expect(deletePolicy('p2')).toBe(false);
  });

  it('returns default agent policy for unknown agentId', () => {
    const p = getAgentPolicy('new-agent');
    expect(p.agentId).toBe('new-agent');
    expect(p.requiredApprovalThresholdUsd).toBe(50_000);
    expect(p.blockedCounterparties).toEqual([]);
  });

  it('persists an agent policy override via setAgentPolicy', () => {
    const updated = setAgentPolicy('agent-X', {
      dailyLimitUsd: 1_000_000,
      blockedCounterparties: ['bad-1'],
    });
    expect(updated.dailyLimitUsd).toBe(1_000_000);
    expect(updated.blockedCounterparties).toEqual(['bad-1']);
    expect(getAgentPolicy('agent-X').blockedCounterparties).toEqual(['bad-1']);
  });
});

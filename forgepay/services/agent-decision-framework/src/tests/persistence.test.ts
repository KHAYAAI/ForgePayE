/**
 * Policies, per-agent limits, spend windows and the decision log survive a restart.
 * Unit tests cover the write-through hooks and hydration; the database test (skipped without DATABASE_URL, run in CI against
 * Postgres) restarts for real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  addPolicy, deletePolicy, getAgentPolicy, hydratePolicies, listPolicies, resetPolicies, setAgentPolicy, setPolicySink,
  updatePolicy, listDefaultPolicies,
} from '../policies';
import { clearVelocity, getVelocity, hydrateVelocity, recordTransaction, setVelocitySink } from '../velocity';
import { clearDecisionLog, getDecisionHistory, hydrateDecisions, recordDecision, setDecisionSink } from '../decision-log';
import { assertPersistenceConfigured, isDbEnabled } from '../persistence';
import type { Decision } from '../types';

afterEach(() => {
  setPolicySink(null); setVelocitySink(null); setDecisionSink(null);
  resetPolicies(); clearVelocity(); clearDecisionLog();
});

const decision = (agentId = 'a1'): Decision => ({
  decision: 'approve', score: 10, reasons: [], policy_violations: [], timestamp: new Date().toISOString(), agentId,
  actionType: 'payment', amountUsd: 100, asset: 'USDC', riskScore: { total: 10, components: {} } as unknown as Decision['riskScore'],
});

describe('write-through hooks', () => {
  it('policy changes reach the sink: add, update, delete, and per-agent overrides', () => {
    const calls: string[] = [];
    setPolicySink({
      upsertPolicy: (p) => calls.push(`upsert:${p.id}`),
      removePolicy: (id) => calls.push(`remove:${id}`),
      upsertAgentPolicy: (p) => calls.push(`agent:${p.agentId}`),
    });
    addPolicy({ id: 'px', name: 'X', type: 'block_high_amount', params: { maxAmountUsd: 10 }, enabled: true });
    updatePolicy('px', { enabled: false });
    expect(deletePolicy('px')).toBe(true);
    expect(deletePolicy('px')).toBe(false); // nothing to remove: no second write
    setAgentPolicy('agent_1', { dailyLimitUsd: 5 });
    expect(calls).toEqual(['upsert:px', 'upsert:px', 'remove:px', 'agent:agent_1']);
  });

  it('every recorded spend and decision reaches its sink', () => {
    const spend: Array<[string, number]> = [];
    const decisions: string[] = [];
    setVelocitySink({ record: (agentId, _ts, amount) => spend.push([agentId, amount]) });
    setDecisionSink({ record: (d) => decisions.push(d.agentId) });
    recordTransaction('a1', 25);
    recordDecision(decision('a1'));
    expect(spend).toEqual([['a1', 25]]);
    expect(decisions).toEqual(['a1']);
  });
});

describe('hydration after a restart', () => {
  it('restores each agent\'s rolling spend, so a restart does not reset a velocity limit', () => {
    const now = Date.now();
    hydrateVelocity([
      { agentId: 'a1', timestamp: now - 30 * 60_000, amountUsd: 400 },
      { agentId: 'a1', timestamp: now - 3 * 3_600_000, amountUsd: 100 },
      { agentId: 'a2', timestamp: now - 10 * 60_000, amountUsd: 7 },
    ]);
    const v = getVelocity('a1', now);
    expect(v.last1hUsd).toBe(400);
    expect(v.last24hUsd).toBe(500);
    expect(v.txCount24h).toBe(2);
    expect(getVelocity('a2', now).last1hUsd).toBe(7);
  });

  it('restores policies and overrides exactly, including an operator having deleted every policy', () => {
    hydratePolicies([{ id: 'only', name: 'Only', type: 'block_high_amount', params: { maxAmountUsd: 1 }, enabled: true }],
      [{ agentId: 'a1', riskTolerance: 10, dailyLimitUsd: 99, blockedCounterparties: ['bad'], requiredApprovalThresholdUsd: 5 }]);
    expect(listPolicies().map((p) => p.id)).toEqual(['only']);
    expect(getAgentPolicy('a1').dailyLimitUsd).toBe(99);
    hydratePolicies([], []);
    expect(listPolicies()).toEqual([]); // stored emptiness is respected, defaults are not re-added
  });

  it('restores the decision log in order, newest last, capped', () => {
    hydrateDecisions([decision('a'), decision('b'), decision('c')]);
    expect(getDecisionHistory(10).map((d) => d.agentId)).toEqual(['c', 'b', 'a']);
  });

  it('exposes the default policies as copies, so editing one cannot change the defaults', () => {
    const d = listDefaultPolicies();
    d[0]!.params['minReputation'] = 999;
    expect(listDefaultPolicies()[0]!.params['minReputation']).not.toBe(999);
  });
});

describe('configuration guard', () => {
  it('refuses to start in production without a database', () => {
    expect(() => assertPersistenceConfigured({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/refuses to start/);
    expect(() => assertPersistenceConfigured({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertPersistenceConfigured({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(isDbEnabled({ DB_HOST: 'h' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

const HAS_DB = Boolean(process.env['DATABASE_URL'] || process.env['DB_HOST']);
const dbSuite = HAS_DB ? describe : describe.skip;

dbSuite('against a real database', () => {
  let persistence: typeof import('../persistence');
  const wait = () => new Promise((r) => setTimeout(r, 400));

  beforeAll(async () => {
    persistence = await import('../persistence');
    await persistence.runMigrations();
    const { Pool } = await import('pg');
    const p = new Pool({ connectionString: process.env['DATABASE_URL'] });
    await p.query('TRUNCATE decision_policies, decision_agent_policies, decision_velocity, decision_log, decision_meta');
    await p.end();
  });
  afterAll(async () => { persistence.detachPersistence(); await persistence.closePool(); });

  it('keeps policies, limits, spend and decisions across a restart, and does not re-seed deleted defaults', async () => {
    await persistence.initPersistence();                 // first start: seeds the defaults once
    expect(listPolicies().map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3']);

    addPolicy({ id: 'custom', name: 'Custom', type: 'block_high_amount', params: { maxAmountUsd: 123 }, enabled: true });
    deletePolicy('p2');
    setAgentPolicy('agent_x', { dailyLimitUsd: 42 });
    recordTransaction('agent_x', 300);
    recordDecision(decision('agent_x'));
    await wait();

    // restart: memory is wiped, state comes back from the database
    persistence.detachPersistence();
    hydratePolicies([], []); clearVelocity(); clearDecisionLog();
    await persistence.initPersistence();

    expect(listPolicies().map((p) => p.id).sort()).toEqual(['custom', 'p1', 'p3']);   // p2 stays deleted
    expect(getAgentPolicy('agent_x').dailyLimitUsd).toBe(42);
    expect(getVelocity('agent_x').last1hUsd).toBe(300);
    expect(getDecisionHistory(5)[0]!.agentId).toBe('agent_x');
  });
});

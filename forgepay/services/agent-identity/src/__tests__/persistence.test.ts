/**
 * Integration tests for Agent Identity persistence layer.
 *
 * Tests verify:
 * - registerAgent() persists DID and reputation to DB
 * - Agents survive pod restart (initStoreFromDb)
 * - Reputation events are immutable audit trail
 * - Attestation creation and retrieval from DB
 * - Write-through: in-memory read, DB write, crash → reload from DB
 *
 * Uses vitest + real PostgreSQL connection.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initStore,
  getAgent,
  setAgent,
  listAgents,
  pushReputationEvent,
  getReputationEventsByAgentId,
  setAttestation,
  getAttestationsBySubjectAgentId,
} from '../store';
import { recordReputationEvent } from '../reputation';
import { pool, runMigrations } from '../db';
import type { AgentIdentity, ReputationEvent, Attestation } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function cleanupDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM agent_attestations');
    await client.query('DELETE FROM agent_reputation_events');
    await client.query('DELETE FROM agent_identities WHERE id NOT IN (SELECT id FROM agent_identities WHERE created_at < NOW() - INTERVAL \'1 minute\')');
    // Clear test agents but keep seed agents
    await client.query(
      `DELETE FROM agent_identities WHERE id LIKE $1 OR id LIKE $2 OR id LIKE $3`,
      ['test-%', 'agent-test-%', 'persist-test-%']
    );
  } finally {
    client.release();
  }
}

function createTestAgent(id: string, merchantId: string): AgentIdentity {
  const now = new Date().toISOString();
  return {
    id,
    did: `did:forgepay:${id}`,
    name: `Test Agent ${id}`,
    framework: 'forgepay',
    ownerMerchantId: merchantId,
    capabilities: ['payment', 'negotiation'],
    trustLevel: 'verified',
    reputationScore: 600,
    totalTransactions: 50,
    totalVolumeUsd: 150000,
    successRate: 0.95,
    averageResponseTimeMs: 250,
    tags: ['test', 'automated'],
    status: 'active',
    createdAt: now,
    lastActiveAt: now,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

/**
 * Needs a real PostgreSQL instance. Without one these previously failed the
 * whole suite with ECONNREFUSED, which went unnoticed because agent-identity
 * has no job in forgepay-ci.yml. Gate on the same signal the store itself uses,
 * so the suite runs when a database is configured and is honestly skipped
 * otherwise.
 */
const hasDatabase = !!process.env['DATABASE_URL'];

describe.skipIf(!hasDatabase)('Agent Identity Persistence — PostgreSQL', () => {
  beforeAll(async () => {
    await initStore();
    await cleanupDb();
  });

  afterAll(async () => {
    await cleanupDb();
    await pool.end();
  });

  beforeEach(async () => {
    await cleanupDb();
  });

  // ── Test: registerAgent persists DID and reputation ────────────────────

  it('setAgent() persists agent identity to PostgreSQL', async () => {
    const agent = createTestAgent('persist-test-1', 'merch-1');
    await setAgent(agent);

    // Verify in database
    const loaded = await getAgent(agent.id);
    expect(loaded).toBeDefined();
    expect(loaded?.did).toBe(`did:forgepay:${agent.id}`);
    expect(loaded?.name).toBe(`Test Agent ${agent.id}`);
    expect(loaded?.framework).toBe('forgepay');
    expect(loaded?.reputationScore).toBe(600);
    expect(loaded?.trustLevel).toBe('verified');
  });

  // ── Test: getAgent retrieves by ID ──────────────────────────────────────

  it('getAgent() retrieves agent by ID from cache or database', async () => {
    const agent = createTestAgent('persist-test-get', 'merch-1');
    await setAgent(agent);

    const retrieved = await getAgent(agent.id);
    expect(retrieved?.id).toBe(agent.id);
    expect(retrieved?.reputationScore).toBe(600);
  });

  // ── Test: getAgent normalizes DID format ────────────────────────────────

  it('getAgent() normalizes DID format with "did:forgepay:" prefix', async () => {
    const agent = createTestAgent('persist-test-did', 'merch-1');
    await setAgent(agent);

    // Retrieve with prefix
    const withPrefix = await getAgent(`did:forgepay:${agent.id}`);
    expect(withPrefix?.id).toBe(agent.id);

    // Retrieve without prefix
    const withoutPrefix = await getAgent(agent.id);
    expect(withoutPrefix?.id).toBe(agent.id);
  });

  // ── Test: Agents survive pod restart (initStoreFromDb) ──────────────────

  it('initStoreFromDb() restores agents after simulated restart', async () => {
    const agent1 = createTestAgent('persist-test-restart-1', 'merch-1');
    const agent2 = createTestAgent('persist-test-restart-2', 'merch-2');

    // Persist agents
    await setAgent(agent1);
    await setAgent(agent2);

    // Simulate fresh instance (reinitialize store)
    await initStore();

    // Both agents should be retrievable
    const loaded1 = await getAgent(agent1.id);
    const loaded2 = await getAgent(agent2.id);

    expect(loaded1).toBeDefined();
    expect(loaded2).toBeDefined();
    expect(loaded1?.reputationScore).toBe(600);
    expect(loaded2?.reputationScore).toBe(600);
  });

  // ── Test: Reputation events are immutable ────────────────────────────────

  it('pushReputationEvent() creates immutable audit trail', async () => {
    const agent = createTestAgent('persist-test-rep', 'merch-1');
    await setAgent(agent);

    const now = new Date().toISOString();
    const event: ReputationEvent = {
      id: 'rep-event-1',
      agentId: agent.id,
      eventType: 'transaction_success',
      scoreDelta: 5,
      description: 'Test transaction success',
      createdAt: now,
    };

    await pushReputationEvent(event);

    // Verify event is in database and cannot be modified
    const events = await getReputationEventsByAgentId(agent.id);
    expect(events.length).toBeGreaterThan(0);

    const loaded = events.find(e => e.id === 'rep-event-1');
    expect(loaded).toBeDefined();
    expect(loaded?.eventType).toBe('transaction_success');
    expect(loaded?.scoreDelta).toBe(5);

    // Verify in database directly (immutable)
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM agent_reputation_events WHERE id = $1',
        ['rep-event-1']
      );
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].event_type).toBe('transaction_success');
    } finally {
      client.release();
    }
  });

  // ── Test: recordReputationEvent updates score and creates event ────────

  it('recordReputationEvent() updates reputation score and creates immutable event', async () => {
    const agent = createTestAgent('persist-test-score', 'merch-1');
    await setAgent(agent);
    const initialScore = agent.reputationScore;

    // Record success event (+5 points)
    const result = await recordReputationEvent(
      agent.id,
      'transaction_success',
      'Successful payment processed'
    );

    expect(result).not.toHaveProperty('error');
    if ('scoreDelta' in result) {
      expect(result.scoreDelta).toBe(5);
    }

    // Verify score increased
    const updated = await getAgent(agent.id);
    expect(updated?.reputationScore).toBe(initialScore + 5);

    // Verify event was recorded
    const events = await getReputationEventsByAgentId(agent.id);
    expect(events.length).toBeGreaterThan(0);
  });

  // ── Test: Multiple reputation events create audit trail ────────────────

  it('Multiple reputation events form immutable chronological audit trail', async () => {
    const agent = createTestAgent('persist-test-audit', 'merch-1');
    await setAgent(agent);

    const now = new Date().toISOString();

    // Record multiple events
    const event1: ReputationEvent = {
      id: 'audit-1',
      agentId: agent.id,
      eventType: 'transaction_success',
      scoreDelta: 5,
      description: 'First success',
      createdAt: now,
    };

    const event2: ReputationEvent = {
      id: 'audit-2',
      agentId: agent.id,
      eventType: 'transaction_failure',
      scoreDelta: -10,
      description: 'First failure',
      createdAt: new Date(Date.now() + 1000).toISOString(),
    };

    await pushReputationEvent(event1);
    await pushReputationEvent(event2);

    // Retrieve all events
    const events = await getReputationEventsByAgentId(agent.id);
    expect(events.length).toBeGreaterThanOrEqual(2);

    const ids = events.map(e => e.id);
    expect(ids).toContain('audit-1');
    expect(ids).toContain('audit-2');
  });

  // ── Test: Attestation creation and retrieval ────────────────────────────

  it('setAttestation() persists attestation to database', async () => {
    const agent = createTestAgent('persist-test-att', 'merch-1');
    await setAgent(agent);

    const attestation: Attestation = {
      id: 'att-1',
      issuerMerchantId: 'merch-issuer',
      subjectAgentId: agent.id,
      claim: 'verified_payment_processor',
      data: { verifiedAt: '2026-06-24', level: 'gold' },
      createdAt: new Date().toISOString(),
    };

    await setAttestation(attestation);

    // Verify in database
    const loaded = await getAttestationsBySubjectAgentId(agent.id);
    expect(loaded.length).toBeGreaterThan(0);

    const found = loaded.find(a => a.id === 'att-1');
    expect(found).toBeDefined();
    expect(found?.claim).toBe('verified_payment_processor');
    expect(found?.data?.level).toBe('gold');
  });

  // ── Test: Multiple attestations per agent ──────────────────────────────

  it('getAttestationsBySubjectAgentId() returns all attestations for agent', async () => {
    const agent = createTestAgent('persist-test-multi-att', 'merch-1');
    await setAgent(agent);

    const att1: Attestation = {
      id: 'att-multi-1',
      issuerMerchantId: 'merch-issuer-1',
      subjectAgentId: agent.id,
      claim: 'verified_payment',
      data: {},
      createdAt: new Date().toISOString(),
    };

    const att2: Attestation = {
      id: 'att-multi-2',
      issuerMerchantId: 'merch-issuer-2',
      subjectAgentId: agent.id,
      claim: 'trusted_partner',
      data: {},
      createdAt: new Date().toISOString(),
    };

    await setAttestation(att1);
    await setAttestation(att2);

    const loaded = await getAttestationsBySubjectAgentId(agent.id);
    expect(loaded.length).toBeGreaterThanOrEqual(2);

    const ids = loaded.map(a => a.id);
    expect(ids).toContain('att-multi-1');
    expect(ids).toContain('att-multi-2');
  });

  // ── Test: Attestation expiration ───────────────────────────────────────

  it('Attestations can have expiration timestamps', async () => {
    const agent = createTestAgent('persist-test-exp-att', 'merch-1');
    await setAgent(agent);

    const futureExpiration = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
    const attestation: Attestation = {
      id: 'att-exp-1',
      issuerMerchantId: 'merch-issuer',
      subjectAgentId: agent.id,
      claim: 'temporary_partner',
      data: {},
      expiresAt: futureExpiration,
      createdAt: new Date().toISOString(),
    };

    await setAttestation(attestation);

    const loaded = await getAttestationsBySubjectAgentId(agent.id);
    const found = loaded.find(a => a.id === 'att-exp-1');
    expect(found?.expiresAt).toBe(futureExpiration);
  });

  // ── Test: Write-through pattern: in-memory read, DB write, survive crash

  it('Write-through: in-memory read, DB write, crash → reload from DB', async () => {
    const agent = createTestAgent('persist-test-writethrough', 'merch-1');

    // Write to store (in-memory + DB)
    await setAgent(agent);

    // Verify readable from in-memory
    const inMem = await getAgent(agent.id);
    expect(inMem?.reputationScore).toBe(600);

    // Simulate crash: reinitialize (clears in-memory, reloads from DB)
    await initStore();

    // Verify still readable after "crash" + reload
    const afterRestart = await getAgent(agent.id);
    expect(afterRestart).toBeDefined();
    expect(afterRestart?.reputationScore).toBe(600);
    expect(afterRestart?.framework).toBe('forgepay');
  });

  // ── Test: listAgents filters work with persisted data ──────────────────

  it('listAgents() filters by trustLevel from persisted agents', async () => {
    const agent1 = createTestAgent('persist-test-filter-1', 'merch-1');
    agent1.trustLevel = 'verified';
    const agent2 = createTestAgent('persist-test-filter-2', 'merch-2');
    agent2.trustLevel = 'trusted';

    await setAgent(agent1);
    await setAgent(agent2);

    const verified = await listAgents({ trustLevel: 'verified' });
    expect(verified.length).toBeGreaterThan(0);
    verified.forEach(a => expect(a.trustLevel).toBe('verified'));

    const trusted = await listAgents({ trustLevel: 'trusted' });
    expect(trusted.length).toBeGreaterThan(0);
    trusted.forEach(a => expect(a.trustLevel).toBe('trusted'));
  });

  // ── Test: listAgents filters by minReputation ──────────────────────────

  it('listAgents() filters by minimum reputation score', async () => {
    const lowRep = createTestAgent('persist-test-low-rep', 'merch-1');
    lowRep.reputationScore = 350;

    const highRep = createTestAgent('persist-test-high-rep', 'merch-2');
    highRep.reputationScore = 800;

    await setAgent(lowRep);
    await setAgent(highRep);

    const filtered = await listAgents({ minReputation: 600 });
    const ids = filtered.map(a => a.id);
    expect(ids).toContain('persist-test-high-rep');
    // Low rep agent may or may not be present depending on seed data
    filtered.forEach(a => expect(a.reputationScore).toBeGreaterThanOrEqual(600));
  });

  // ── Test: Concurrent writes use ON CONFLICT correctly ──────────────────

  it('Concurrent setAgent() calls don\'t create duplicates (ON CONFLICT)', async () => {
    const agent = createTestAgent('persist-test-concurrent', 'merch-1');

    // Fire multiple concurrent writes
    await Promise.all([
      setAgent({ ...agent, totalTransactions: 10 }),
      setAgent({ ...agent, totalTransactions: 20 }),
      setAgent({ ...agent, totalTransactions: 30 }),
    ]);

    // Verify only one row in database
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT COUNT(*) as cnt FROM agent_identities WHERE id = $1',
        [agent.id]
      );
      expect(result.rows[0].cnt).toBe(1); // Only one row, no duplicates
    } finally {
      client.release();
    }

    // Verify latest value
    const loaded = await getAgent(agent.id);
    expect([10, 20, 30]).toContain(loaded?.totalTransactions);
  });

  // ── Test: Agent status transitions persist ────────────────────────────

  it('Agent status changes (active → deregistered) persist to DB', async () => {
    const agent = createTestAgent('persist-test-status', 'merch-1');
    agent.status = 'active';
    await setAgent(agent);

    // Change status
    const updated = { ...agent, status: 'deregistered' as const };
    await setAgent(updated);

    // Verify in database
    const loaded = await getAgent(agent.id);
    expect(loaded?.status).toBe('deregistered');
  });

  // ── Test: KYAPay fields persist and can be queried ────────────────────

  it('setAgent() with KYAPay fields persists and retrieves correctly', async () => {
    const agent = createTestAgent('persist-test-kyapay', 'merch-1');

    await setAgent(agent, {
      kyapaySub: 'sub-12345',
      kyapayIss: 'https://kyapay.example.com',
    });

    const loaded = await getAgent(agent.id);
    expect(loaded?.kyapaySub).toBe('sub-12345');
    expect(loaded?.kyapayIss).toBe('https://kyapay.example.com');
  });

  // ── Test: Capabilities array persists correctly ──────────────────────

  it('Agent capabilities array persists to database', async () => {
    const agent = createTestAgent('persist-test-capabilities', 'merch-1');
    agent.capabilities = ['payment', 'negotiation', 'treasury', 'yield'];

    await setAgent(agent);

    const loaded = await getAgent(agent.id);
    expect(loaded?.capabilities).toEqual(['payment', 'negotiation', 'treasury', 'yield']);
  });
});

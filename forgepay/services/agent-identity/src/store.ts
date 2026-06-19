/**
 * Agent Identity store — PostgreSQL-backed with in-memory fallback.
 *
 * If DATABASE_URL is set and reachable, all data is persisted to PostgreSQL.
 * Otherwise (e.g. in tests or local dev without a DB), an in-memory Map is used.
 */

import { pool } from './db';
import type { AgentIdentity, ReputationEvent, Attestation } from './types';

// ── Fallback in-memory store (used when DB unavailable / in tests) ─────────────

const agentMap       = new Map<string, AgentIdentity>();
const reputationMap  = new Map<string, ReputationEvent[]>();
const attestationMap = new Map<string, Attestation>();

let useDb = false;
let storeInitialized = false;

// Seed in-memory store at module load so tests (which never call initStore)
// still have the default seed agents available.
seedInMemory();

export async function initStore(): Promise<void> {
  if (storeInitialized) return;
  storeInitialized = true;

  if (!process.env['DATABASE_URL']) {
    useDb = false;
    // In-memory seed was already applied at module load; nothing more to do.
    return;
  }
  try {
    const { runMigrations } = await import('./db');
    await runMigrations();
    useDb = true;
    await seedDb();
  } catch (err) {
    console.warn('[agent-identity] DB unavailable, falling back to in-memory store:', (err as Error).message);
    useDb = false;
    // In-memory seed already applied at module load.
  }
}

// ── Agents ─────────────────────────────────────────────────────────────────────

export interface AgentFilter {
  framework?:     AgentIdentity['framework'];
  trustLevel?:    AgentIdentity['trustLevel'];
  capability?:    string;
  tag?:           string;
  minReputation?: number;
  status?:        AgentIdentity['status'];
  limit?:         number;
}

export async function getAgent(id: string): Promise<AgentIdentity | undefined> {
  if (!useDb) {
    const normalized = id.startsWith('did:forgepay:') ? id.replace('did:forgepay:', '') : id;
    return agentMap.get(normalized);
  }
  const did = id.startsWith('did:forgepay:') ? id : `did:forgepay:${id}`;
  const res = await pool.query(
    `SELECT * FROM agent_identities WHERE id = $1 OR did = $2 LIMIT 1`,
    [id, did]
  );
  return res.rows[0] ? rowToAgent(res.rows[0]) : undefined;
}

export async function getAgentByKyapaySub(
  sub: string,
  iss: string,
): Promise<AgentIdentity | undefined> {
  if (!useDb) {
    return Array.from(agentMap.values()).find(
      (a) => a.kyapaySub === sub && a.kyapayIss === iss,
    );
  }
  const res = await pool.query(
    `SELECT * FROM agent_identities WHERE kyapay_sub = $1 AND kyapay_iss = $2 LIMIT 1`,
    [sub, iss],
  );
  return res.rows[0] ? rowToAgent(res.rows[0]) : undefined;
}

export interface KYAPayFields {
  kyapaySub?: string;
  kyapayIss?: string;
}

export async function setAgent(agent: AgentIdentity, kyapay?: KYAPayFields): Promise<void> {
  // Merge kyapay fields into the agent object for in-memory store
  const merged: AgentIdentity = {
    ...agent,
    kyapaySub: kyapay?.kyapaySub ?? agent.kyapaySub,
    kyapayIss: kyapay?.kyapayIss ?? agent.kyapayIss,
  };
  if (!useDb) { agentMap.set(merged.id, merged); return; }
  await pool.query(`
    INSERT INTO agent_identities
      (id, did, name, framework, owner_merchant_id, capabilities, trust_level,
       reputation_score, total_transactions, total_volume_usd, success_rate,
       average_response_time_ms, tags, metadata, endpoint, public_key, webhook_url, status,
       created_at, last_active_at, kyapay_sub, kyapay_iss)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    ON CONFLICT (id) DO UPDATE SET
      name=EXCLUDED.name, framework=EXCLUDED.framework,
      capabilities=EXCLUDED.capabilities, trust_level=EXCLUDED.trust_level,
      reputation_score=EXCLUDED.reputation_score,
      total_transactions=EXCLUDED.total_transactions,
      total_volume_usd=EXCLUDED.total_volume_usd, success_rate=EXCLUDED.success_rate,
      average_response_time_ms=EXCLUDED.average_response_time_ms,
      tags=EXCLUDED.tags, metadata=EXCLUDED.metadata, endpoint=EXCLUDED.endpoint,
      public_key=EXCLUDED.public_key, webhook_url=EXCLUDED.webhook_url,
      status=EXCLUDED.status, last_active_at=EXCLUDED.last_active_at,
      kyapay_sub=EXCLUDED.kyapay_sub, kyapay_iss=EXCLUDED.kyapay_iss
  `, [
    merged.id, merged.did, merged.name, merged.framework, merged.ownerMerchantId,
    JSON.stringify(merged.capabilities), merged.trustLevel, merged.reputationScore,
    merged.totalTransactions, merged.totalVolumeUsd, merged.successRate,
    merged.averageResponseTimeMs, JSON.stringify(merged.tags),
    JSON.stringify({}),
    null,
    merged.publicKey ?? null,
    merged.webhookUrl ?? null,
    merged.status, merged.createdAt, merged.lastActiveAt,
    merged.kyapaySub ?? null,
    merged.kyapayIss ?? null,
  ]);
}

export async function listAgents(filter: AgentFilter = {}): Promise<AgentIdentity[]> {
  if (!useDb) {
    let results = Array.from(agentMap.values());
    if (filter.status !== undefined) {
      results = results.filter(a => a.status === filter.status);
    } else {
      results = results.filter(a => a.status !== 'deregistered');
    }
    if (filter.framework)            results = results.filter(a => a.framework === filter.framework);
    if (filter.trustLevel)           results = results.filter(a => a.trustLevel === filter.trustLevel);
    if (filter.capability)           results = results.filter(a => a.capabilities.includes(filter.capability!));
    if (filter.tag)                  results = results.filter(a => a.tags.includes(filter.tag!));
    if (filter.minReputation !== undefined) results = results.filter(a => a.reputationScore >= filter.minReputation!);
    return results.slice(0, filter.limit ?? 20);
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filter.status !== undefined) {
    conditions.push(`status = $${idx++}`); params.push(filter.status);
  } else {
    conditions.push(`status != 'deregistered'`);
  }
  if (filter.framework)  { conditions.push(`framework = $${idx++}`);                              params.push(filter.framework); }
  if (filter.trustLevel) { conditions.push(`trust_level = $${idx++}`);                            params.push(filter.trustLevel); }
  if (filter.capability) { conditions.push(`capabilities @> $${idx++}::jsonb`);                   params.push(JSON.stringify([filter.capability])); }
  if (filter.tag)        { conditions.push(`tags @> $${idx++}::jsonb`);                           params.push(JSON.stringify([filter.tag])); }
  if (filter.minReputation !== undefined) { conditions.push(`reputation_score >= $${idx++}`);     params.push(filter.minReputation); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ?? 20;
  params.push(limit);
  const res = await pool.query(`SELECT * FROM agent_identities ${where} LIMIT $${idx}`, params);
  return res.rows.map(rowToAgent);
}

// ── Reputation Events ─────────────────────────────────────────────────────────

export async function pushReputationEvent(event: ReputationEvent): Promise<void> {
  if (!useDb) {
    const events = reputationMap.get(event.agentId) ?? [];
    events.push(event);
    reputationMap.set(event.agentId, events);
    return;
  }
  await pool.query(`
    INSERT INTO agent_reputation_events
      (id, agent_id, event_type, score_delta, description, related_agent_id, transaction_id, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [
    event.id, event.agentId, event.eventType, event.scoreDelta,
    event.description ?? null,
    event.relatedAgentId ?? null,
    event.transactionId ?? null,
    event.createdAt,
  ]);
}

export async function getReputationEventsByAgentId(agentId: string): Promise<ReputationEvent[]> {
  if (!useDb) return reputationMap.get(agentId) ?? [];
  const res = await pool.query(
    `SELECT * FROM agent_reputation_events WHERE agent_id = $1 ORDER BY created_at DESC`,
    [agentId]
  );
  return res.rows.map(rowToRepEvent);
}

// ── Attestations ──────────────────────────────────────────────────────────────

export async function setAttestation(attestation: Attestation): Promise<void> {
  if (!useDb) { attestationMap.set(attestation.id, attestation); return; }
  await pool.query(`
    INSERT INTO agent_attestations
      (id, issuer_agent_id, issuer_merchant_id, subject_agent_id, claim, data, expires_at, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (id) DO NOTHING
  `, [
    attestation.id,
    attestation.issuerAgentId ?? null,
    attestation.issuerMerchantId,
    attestation.subjectAgentId,
    attestation.claim,
    JSON.stringify(attestation.data),
    attestation.expiresAt ?? null,
    attestation.createdAt,
  ]);
}

export async function getAttestationsBySubjectAgentId(subjectAgentId: string): Promise<Attestation[]> {
  if (!useDb) return Array.from(attestationMap.values()).filter(a => a.subjectAgentId === subjectAgentId);
  const res = await pool.query(
    `SELECT * FROM agent_attestations WHERE subject_agent_id = $1 ORDER BY created_at DESC`,
    [subjectAgentId]
  );
  return res.rows.map(rowToAttestation);
}

// ── Row mappers ────────────────────────────────────────────────────────────────

function rowToAgent(row: Record<string, unknown>): AgentIdentity {
  return {
    id:                    row['id'] as string,
    did:                   row['did'] as string,
    name:                  row['name'] as string,
    framework:             row['framework'] as AgentIdentity['framework'],
    ownerMerchantId:       row['owner_merchant_id'] as string,
    publicKey:             row['public_key'] as string | undefined,
    webhookUrl:            row['webhook_url'] as string | undefined,
    capabilities:          row['capabilities'] as string[],
    trustLevel:            row['trust_level'] as AgentIdentity['trustLevel'],
    reputationScore:       Number(row['reputation_score']),
    totalTransactions:     Number(row['total_transactions']),
    totalVolumeUsd:        Number(row['total_volume_usd']),
    successRate:           Number(row['success_rate']),
    averageResponseTimeMs: Number(row['average_response_time_ms']),
    tags:                  row['tags'] as string[],
    status:                row['status'] as AgentIdentity['status'],
    createdAt:             (row['created_at'] as Date).toISOString(),
    lastActiveAt:          (row['last_active_at'] as Date).toISOString(),
    kyapaySub:             row['kyapay_sub'] as string | undefined ?? undefined,
    kyapayIss:             row['kyapay_iss'] as string | undefined ?? undefined,
  };
}

function rowToRepEvent(row: Record<string, unknown>): ReputationEvent {
  return {
    id:             row['id'] as string,
    agentId:        row['agent_id'] as string,
    eventType:      row['event_type'] as ReputationEvent['eventType'],
    scoreDelta:     Number(row['score_delta']),
    description:    (row['description'] ?? '') as string,
    relatedAgentId: row['related_agent_id'] as string | undefined,
    transactionId:  row['transaction_id'] as string | undefined,
    createdAt:      (row['created_at'] as Date).toISOString(),
  };
}

function rowToAttestation(row: Record<string, unknown>): Attestation {
  return {
    id:               row['id'] as string,
    subjectAgentId:   row['subject_agent_id'] as string,
    issuerAgentId:    row['issuer_agent_id'] as string | undefined,
    issuerMerchantId: row['issuer_merchant_id'] as string,
    claim:            row['claim'] as string,
    data:             row['data'] as Record<string, unknown>,
    expiresAt:        row['expires_at'] ? (row['expires_at'] as Date).toISOString() : undefined,
    createdAt:        (row['created_at'] as Date).toISOString(),
  };
}

// ── Seed data ──────────────────────────────────────────────────────────────────

function seedInMemory(): void {
  const NOW = new Date().toISOString();
  const seed1: AgentIdentity = {
    id:                    'treasury-oracle-1',
    did:                   'did:forgepay:treasury-oracle-1',
    name:                  'Treasury Oracle',
    framework:             'forgepay',
    ownerMerchantId:       'merchant-forgepay-internal',
    capabilities:          ['payment', 'treasury', 'yield'],
    trustLevel:            'trusted',
    reputationScore:       820,
    totalTransactions:     1240,
    totalVolumeUsd:        4_850_000,
    successRate:           0.98,
    averageResponseTimeMs: 320,
    tags:                  ['treasury', 'yield', 'institutional'],
    createdAt:             NOW,
    lastActiveAt:          NOW,
    status:                'active',
  };
  const seed2: AgentIdentity = {
    id:                    'marketplace-buyer-1',
    did:                   'did:forgepay:marketplace-buyer-1',
    name:                  'Marketplace Buyer Agent',
    framework:             'elizaos',
    ownerMerchantId:       'merchant-demo-marketplace',
    capabilities:          ['payment', 'negotiation'],
    trustLevel:            'verified',
    reputationScore:       650,
    totalTransactions:     342,
    totalVolumeUsd:        275_000,
    successRate:           0.94,
    averageResponseTimeMs: 480,
    tags:                  ['marketplace', 'data_broker'],
    createdAt:             NOW,
    lastActiveAt:          NOW,
    status:                'active',
  };
  agentMap.set(seed1.id, seed1);
  agentMap.set(seed2.id, seed2);
}

async function seedDb(): Promise<void> {
  const NOW = new Date().toISOString();
  const agents: AgentIdentity[] = [
    {
      id: 'treasury-oracle-1', did: 'did:forgepay:treasury-oracle-1',
      name: 'Treasury Oracle', framework: 'forgepay',
      ownerMerchantId: 'merchant-forgepay-internal',
      capabilities: ['payment', 'treasury', 'yield'], trustLevel: 'trusted',
      reputationScore: 820, totalTransactions: 1240, totalVolumeUsd: 4_850_000,
      successRate: 0.98, averageResponseTimeMs: 320,
      tags: ['treasury', 'yield', 'institutional'],
      status: 'active', createdAt: NOW, lastActiveAt: NOW,
    },
    {
      id: 'marketplace-buyer-1', did: 'did:forgepay:marketplace-buyer-1',
      name: 'Marketplace Buyer Agent', framework: 'elizaos',
      ownerMerchantId: 'merchant-demo-marketplace',
      capabilities: ['payment', 'negotiation'], trustLevel: 'verified',
      reputationScore: 650, totalTransactions: 342, totalVolumeUsd: 275_000,
      successRate: 0.94, averageResponseTimeMs: 480,
      tags: ['marketplace', 'data_broker'],
      status: 'active', createdAt: NOW, lastActiveAt: NOW,
    },
  ];
  for (const a of agents) await setAgent(a);
}

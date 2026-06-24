/**
 * Agent Identity Store — PostgreSQL-backed with in-memory cache.
 *
 * Uses write-through caching pattern:
 * - All reads check in-memory cache first for speed
 * - All writes update both cache and database (DB writes are best-effort)
 * - If DATABASE_URL is unset or DB is unreachable, falls back to in-memory only
 *
 * On startup, loadStoreFromDb() populates the cache from the database,
 * ensuring cold starts don't lose data after pod restarts.
 */

import { pool } from './db';
import type { AgentIdentity, ReputationEvent, Attestation } from './types';

// ── In-memory cache (always used for fast reads) ─────────────────────────────

const agentMap = new Map<string, AgentIdentity>();
const reputationMap = new Map<string, ReputationEvent[]>();
const attestationMap = new Map<string, Attestation>();

let useDb = false;
let storeInitialized = false;

// Seed in-memory store at module load so tests (which never call initStore)
// still have the default seed agents available.
seedInMemory();

/**
 * Initialize the store: run DB migrations, load DB into cache, set useDb flag.
 * Safe to call multiple times (uses storeInitialized guard).
 */
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
    await loadStoreFromDb();
  } catch (err) {
    console.warn(
      '[agent-identity] DB unavailable, falling back to in-memory store:',
      (err as Error).message
    );
    useDb = false;
    // In-memory seed already applied at module load.
  }
}

/**
 * Load all agents, events, and attestations from DB into the in-memory cache.
 * Called once during startup after migrations.
 */
async function loadStoreFromDb(): Promise<void> {
  try {
    // Load agents
    const agentsRes = await pool.query('SELECT * FROM agent_identities');
    agentMap.clear();
    for (const row of agentsRes.rows) {
      const agent = rowToAgent(row);
      agentMap.set(agent.id, agent);
    }

    // Load reputation events
    const eventsRes = await pool.query('SELECT * FROM agent_reputation_events ORDER BY created_at DESC');
    reputationMap.clear();
    for (const row of eventsRes.rows) {
      const event = rowToRepEvent(row);
      const events = reputationMap.get(event.agentId) ?? [];
      events.push(event);
      reputationMap.set(event.agentId, events);
    }

    // Load attestations
    const attsRes = await pool.query('SELECT * FROM agent_attestations ORDER BY created_at DESC');
    attestationMap.clear();
    for (const row of attsRes.rows) {
      const att = rowToAttestation(row);
      attestationMap.set(att.id, att);
    }

    console.log(
      `[agent-identity] Loaded ${agentMap.size} agents, ${eventsRes.rows.length} reputation events, ${attsRes.rows.length} attestations from DB`
    );
  } catch (err) {
    console.warn('[agent-identity] Failed to load store from DB:', (err as Error).message);
    useDb = false;
  }
}

// ── Agents ─────────────────────────────────────────────────────────────────

export interface AgentFilter {
  framework?: AgentIdentity['framework'];
  trustLevel?: AgentIdentity['trustLevel'];
  capability?: string;
  tag?: string;
  minReputation?: number;
  status?: AgentIdentity['status'];
  limit?: number;
}

/**
 * Get agent by ID or DID (with or without "did:forgepay:" prefix).
 * Reads from in-memory cache for speed.
 */
export async function getAgent(id: string): Promise<AgentIdentity | undefined> {
  // Try cache first
  if (agentMap.has(id)) return agentMap.get(id);

  // Normalize DID format and try again
  const normalized = id.startsWith('did:forgepay:') ? id.replace('did:forgepay:', '') : id;
  if (agentMap.has(normalized)) return agentMap.get(normalized);

  // Fall through to DB if not in cache (stale data case)
  if (!useDb) return undefined;

  const did = normalized.startsWith('did:forgepay:') ? normalized : `did:forgepay:${normalized}`;
  const res = await pool.query(
    `SELECT * FROM agent_identities WHERE id = $1 OR did = $2 LIMIT 1`,
    [normalized, did]
  );
  return res.rows[0] ? rowToAgent(res.rows[0]) : undefined;
}

/**
 * Get agent by KYAPay (sub, iss) credentials — for external agent imports.
 */
export async function getAgentByKyapaySub(
  sub: string,
  iss: string
): Promise<AgentIdentity | undefined> {
  // Check cache first
  for (const agent of agentMap.values()) {
    if (agent.kyapaySub === sub && agent.kyapayIss === iss) return agent;
  }

  // Fall through to DB
  if (!useDb) return undefined;

  const res = await pool.query(
    `SELECT * FROM agent_identities WHERE kyapay_sub = $1 AND kyapay_iss = $2 LIMIT 1`,
    [sub, iss]
  );
  return res.rows[0] ? rowToAgent(res.rows[0]) : undefined;
}

export interface KYAPayFields {
  kyapaySub?: string;
  kyapayIss?: string;
}

/**
 * Upsert agent: update cache + write to DB (best-effort).
 * Uses ON CONFLICT (did) DO UPDATE for idempotent upserts.
 */
export async function setAgent(agent: AgentIdentity, kyapay?: KYAPayFields): Promise<void> {
  // Merge kyapay fields
  const merged: AgentIdentity = {
    ...agent,
    kyapaySub: kyapay?.kyapaySub ?? agent.kyapaySub,
    kyapayIss: kyapay?.kyapayIss ?? agent.kyapayIss,
  };

  // Update cache (always happens)
  agentMap.set(merged.id, merged);

  // Write to DB (best-effort, failures are logged but don't throw)
  if (!useDb) return;

  await pool
    .query(
      `
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
  `,
      [
        merged.id,
        merged.did,
        merged.name,
        merged.framework,
        merged.ownerMerchantId,
        JSON.stringify(merged.capabilities),
        merged.trustLevel,
        merged.reputationScore,
        merged.totalTransactions,
        merged.totalVolumeUsd,
        merged.successRate,
        merged.averageResponseTimeMs,
        JSON.stringify(merged.tags),
        JSON.stringify({}),
        null,
        merged.publicKey ?? null,
        merged.webhookUrl ?? null,
        merged.status,
        merged.createdAt,
        merged.lastActiveAt,
        merged.kyapaySub ?? null,
        merged.kyapayIss ?? null,
      ]
    )
    .catch((err) => {
      console.warn('[agent-identity] DB write failed for agent', merged.id, ':', (err as Error).message);
    });
}

/**
 * List agents with optional filters. Searches in-memory cache.
 */
export async function listAgents(filter: AgentFilter = {}): Promise<AgentIdentity[]> {
  let results = Array.from(agentMap.values());

  if (filter.status !== undefined) {
    results = results.filter((a) => a.status === filter.status);
  } else {
    results = results.filter((a) => a.status !== 'deregistered');
  }
  if (filter.framework) results = results.filter((a) => a.framework === filter.framework);
  if (filter.trustLevel) results = results.filter((a) => a.trustLevel === filter.trustLevel);
  if (filter.capability)
    results = results.filter((a) => a.capabilities.includes(filter.capability!));
  if (filter.tag) results = results.filter((a) => a.tags.includes(filter.tag!));
  if (filter.minReputation !== undefined)
    results = results.filter((a) => a.reputationScore >= filter.minReputation!);

  return results.slice(0, filter.limit ?? 20);
}

// ── Reputation Events ──────────────────────────────────────────────────────

/**
 * Record a reputation event in cache + DB (best-effort).
 */
export async function pushReputationEvent(event: ReputationEvent): Promise<void> {
  // Update cache
  const events = reputationMap.get(event.agentId) ?? [];
  events.unshift(event); // Prepend (most recent first)
  reputationMap.set(event.agentId, events);

  // Write to DB (best-effort)
  if (!useDb) return;

  await pool
    .query(
      `
    INSERT INTO agent_reputation_events
      (id, agent_id, event_type, score_delta, description, related_agent_id, transaction_id, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `,
      [
        event.id,
        event.agentId,
        event.eventType,
        event.scoreDelta,
        event.description ?? null,
        event.relatedAgentId ?? null,
        event.transactionId ?? null,
        event.createdAt,
      ]
    )
    .catch((err) => {
      console.warn(
        '[agent-identity] DB write failed for reputation event',
        event.id,
        ':',
        (err as Error).message
      );
    });
}

/**
 * Get reputation events for an agent, sorted most recent first.
 */
export async function getReputationEventsByAgentId(agentId: string): Promise<ReputationEvent[]> {
  return reputationMap.get(agentId) ?? [];
}

// ── Attestations ───────────────────────────────────────────────────────────

/**
 * Add an attestation to cache + DB (best-effort).
 */
export async function setAttestation(attestation: Attestation): Promise<void> {
  // Update cache
  attestationMap.set(attestation.id, attestation);

  // Write to DB (best-effort, DO NOTHING on conflict)
  if (!useDb) return;

  await pool
    .query(
      `
    INSERT INTO agent_attestations
      (id, issuer_agent_id, issuer_merchant_id, subject_agent_id, claim, data, expires_at, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (id) DO NOTHING
  `,
      [
        attestation.id,
        attestation.issuerAgentId ?? null,
        attestation.issuerMerchantId,
        attestation.subjectAgentId,
        attestation.claim,
        JSON.stringify(attestation.data),
        attestation.expiresAt ?? null,
        attestation.createdAt,
      ]
    )
    .catch((err) => {
      console.warn(
        '[agent-identity] DB write failed for attestation',
        attestation.id,
        ':',
        (err as Error).message
      );
    });
}

/**
 * Get all attestations for a subject agent.
 */
export async function getAttestationsBySubjectAgentId(
  subjectAgentId: string
): Promise<Attestation[]> {
  return Array.from(attestationMap.values()).filter((a) => a.subjectAgentId === subjectAgentId);
}

// ── Row mappers ────────────────────────────────────────────────────────────

function rowToAgent(row: Record<string, unknown>): AgentIdentity {
  return {
    id: row['id'] as string,
    did: row['did'] as string,
    name: row['name'] as string,
    framework: row['framework'] as AgentIdentity['framework'],
    ownerMerchantId: row['owner_merchant_id'] as string,
    publicKey: (row['public_key'] as string | undefined) ?? undefined,
    webhookUrl: (row['webhook_url'] as string | undefined) ?? undefined,
    capabilities: row['capabilities'] as string[],
    trustLevel: row['trust_level'] as AgentIdentity['trustLevel'],
    reputationScore: Number(row['reputation_score']),
    totalTransactions: Number(row['total_transactions']),
    totalVolumeUsd: Number(row['total_volume_usd']),
    successRate: Number(row['success_rate']),
    averageResponseTimeMs: Number(row['average_response_time_ms']),
    tags: row['tags'] as string[],
    status: row['status'] as AgentIdentity['status'],
    createdAt: (row['created_at'] as Date).toISOString(),
    lastActiveAt: (row['last_active_at'] as Date).toISOString(),
    kyapaySub: (row['kyapay_sub'] as string | undefined) ?? undefined,
    kyapayIss: (row['kyapay_iss'] as string | undefined) ?? undefined,
  };
}

function rowToRepEvent(row: Record<string, unknown>): ReputationEvent {
  return {
    id: row['id'] as string,
    agentId: row['agent_id'] as string,
    eventType: row['event_type'] as ReputationEvent['eventType'],
    scoreDelta: Number(row['score_delta']),
    description: (row['description'] ?? '') as string,
    relatedAgentId: (row['related_agent_id'] as string | undefined) ?? undefined,
    transactionId: (row['transaction_id'] as string | undefined) ?? undefined,
    createdAt: (row['created_at'] as Date).toISOString(),
  };
}

function rowToAttestation(row: Record<string, unknown>): Attestation {
  return {
    id: row['id'] as string,
    subjectAgentId: row['subject_agent_id'] as string,
    issuerAgentId: (row['issuer_agent_id'] as string | undefined) ?? undefined,
    issuerMerchantId: row['issuer_merchant_id'] as string,
    claim: row['claim'] as string,
    data: row['data'] as Record<string, unknown>,
    expiresAt: (row['expires_at'] as string | undefined) ?? undefined,
    createdAt: (row['created_at'] as Date).toISOString(),
  };
}

// ── Seed data ──────────────────────────────────────────────────────────────

function seedInMemory(): void {
  const NOW = new Date().toISOString();
  const seed1: AgentIdentity = {
    id: 'treasury-oracle-1',
    did: 'did:forgepay:treasury-oracle-1',
    name: 'Treasury Oracle',
    framework: 'forgepay',
    ownerMerchantId: 'merchant-forgepay-internal',
    capabilities: ['payment', 'treasury', 'yield'],
    trustLevel: 'trusted',
    reputationScore: 820,
    totalTransactions: 1240,
    totalVolumeUsd: 4_850_000,
    successRate: 0.98,
    averageResponseTimeMs: 320,
    tags: ['treasury', 'yield', 'institutional'],
    createdAt: NOW,
    lastActiveAt: NOW,
    status: 'active',
  };
  const seed2: AgentIdentity = {
    id: 'marketplace-buyer-1',
    did: 'did:forgepay:marketplace-buyer-1',
    name: 'Marketplace Buyer Agent',
    framework: 'elizaos',
    ownerMerchantId: 'merchant-demo-marketplace',
    capabilities: ['payment', 'negotiation'],
    trustLevel: 'verified',
    reputationScore: 650,
    totalTransactions: 342,
    totalVolumeUsd: 275_000,
    successRate: 0.94,
    averageResponseTimeMs: 480,
    tags: ['marketplace', 'data_broker'],
    createdAt: NOW,
    lastActiveAt: NOW,
    status: 'active',
  };
  agentMap.set(seed1.id, seed1);
  agentMap.set(seed2.id, seed2);
}

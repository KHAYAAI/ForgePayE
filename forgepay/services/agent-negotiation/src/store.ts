/**
 * Store for Agent Negotiation Protocol.
 * Uses PostgreSQL when DATABASE_URL is set, falls back to in-memory Maps otherwise.
 * (Tests run without DATABASE_URL — they always use in-memory mode.)
 */

import { pool } from './db';
import type { NegotiationSession, Escrow } from './types';

// ── In-memory fallback Maps ───────────────────────────────────────────────────

const sessionMap = new Map<string, NegotiationSession>();
const escrowMap  = new Map<string, Escrow>();
let useDb = false;

// ── Row mappers ───────────────────────────────────────────────────────────────

function rowToSession(row: Record<string, unknown>): NegotiationSession {
  return {
    id:               row['id'] as string,
    initiatorAgentId: row['initiator_agent_id'] as string,
    responderAgentId: row['responder_agent_id'] as string,
    subject:          row['subject'] as string,
    status:           row['status'] as NegotiationSession['status'],
    messages:         row['messages'] as NegotiationSession['messages'],
    agreedTerms:      row['agreed_terms'] as NegotiationSession['agreedTerms'],
    escrowId:         row['escrow_id'] as string | undefined,
    totalRounds:      Number(row['total_rounds']),
    maxRounds:        Number(row['max_rounds']),
    createdAt:        (row['created_at'] as Date).toISOString(),
    updatedAt:        (row['updated_at'] as Date).toISOString(),
    expiresAt:        row['expires_at'] ? (row['expires_at'] as Date).toISOString() : (row['created_at'] as Date).toISOString(),
    settlementTxId:   row['settlement_tx_id'] as string | undefined,
  };
}

function rowToEscrow(row: Record<string, unknown>): Escrow {
  return {
    id:            row['id'] as string,
    sessionId:     row['session_id'] as string,
    buyerAgentId:  row['buyer_agent_id'] as string,
    sellerAgentId: row['seller_agent_id'] as string,
    amountUsd:     Number(row['amount_usd']),
    asset:         row['asset'] as Escrow['asset'],
    chain:         row['chain'] as Escrow['chain'],
    status:        row['status'] as Escrow['status'],
    fundedAt:      row['funded_at'] ? (row['funded_at'] as Date).toISOString() : undefined,
    releasedAt:    row['released_at'] ? (row['released_at'] as Date).toISOString() : undefined,
    disputeReason: row['dispute_reason'] as string | undefined,
    createdAt:     (row['created_at'] as Date).toISOString(),
  };
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

const NOW     = new Date().toISOString();
const PAST    = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
const EXPIRES = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // expired yesterday

const seedSession: NegotiationSession = {
  id:               'session-demo-1',
  initiatorAgentId: 'marketplace-buyer-1',
  responderAgentId: 'treasury-oracle-1',
  subject:          'Treasury yield optimization API access',
  status:           'settled',
  messages: [
    {
      id:          'msg-demo-1',
      sessionId:   'session-demo-1',
      fromAgentId: 'marketplace-buyer-1',
      toAgentId:   'treasury-oracle-1',
      role:        'offer',
      terms:       [
        { key: 'price_usd', value: 200, unit: 'USD' },
        { key: 'access_duration_days', value: 30, unit: 'days' },
        { key: 'api_calls_per_day', value: 1000 },
      ],
      message:   'Requesting API access for treasury yield optimization data',
      timestamp: PAST,
    },
    {
      id:          'msg-demo-2',
      sessionId:   'session-demo-1',
      fromAgentId: 'treasury-oracle-1',
      toAgentId:   'marketplace-buyer-1',
      role:        'counter_offer',
      terms:       [
        { key: 'price_usd', value: 250, unit: 'USD' },
        { key: 'access_duration_days', value: 30, unit: 'days' },
        { key: 'api_calls_per_day', value: 1000 },
        { key: 'sla_uptime_percent', value: 99.9 },
      ],
      message:   'Counter with 99.9% SLA guarantee and slight price adjustment',
      timestamp: PAST,
    },
    {
      id:          'msg-demo-3',
      sessionId:   'session-demo-1',
      fromAgentId: 'marketplace-buyer-1',
      toAgentId:   'treasury-oracle-1',
      role:        'accept',
      terms:       [
        { key: 'price_usd', value: 250, unit: 'USD' },
        { key: 'access_duration_days', value: 30, unit: 'days' },
        { key: 'api_calls_per_day', value: 1000 },
        { key: 'sla_uptime_percent', value: 99.9 },
      ],
      message:   'Accepted — proceeding to escrow',
      timestamp: PAST,
    },
  ],
  agreedTerms: [
    { key: 'price_usd', value: 250, unit: 'USD' },
    { key: 'access_duration_days', value: 30, unit: 'days' },
    { key: 'api_calls_per_day', value: 1000 },
    { key: 'sla_uptime_percent', value: 99.9 },
  ],
  escrowId:       'escrow-demo-1',
  totalRounds:    3,
  maxRounds:      10,
  createdAt:      PAST,
  updatedAt:      PAST,
  expiresAt:      EXPIRES,
  settlementTxId: 'tx-demo-settle-abc123',
};

const seedEscrow: Escrow = {
  id:            'escrow-demo-1',
  sessionId:     'session-demo-1',
  buyerAgentId:  'marketplace-buyer-1',
  sellerAgentId: 'treasury-oracle-1',
  amountUsd:     250,
  asset:         'USDC',
  chain:         'base',
  status:        'released',
  fundedAt:      PAST,
  releasedAt:    PAST,
  createdAt:     PAST,
};

function seedInMemory(): void {
  sessionMap.set(seedSession.id, seedSession);
  escrowMap.set(seedEscrow.id, seedEscrow);
}

async function seedDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO negotiation_sessions
         (id, initiator_agent_id, responder_agent_id, subject, status,
          messages, agreed_terms, escrow_id, total_rounds, max_rounds,
          created_at, updated_at, expires_at, settlement_tx_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT DO NOTHING`,
      [
        seedSession.id,
        seedSession.initiatorAgentId,
        seedSession.responderAgentId,
        seedSession.subject,
        seedSession.status,
        JSON.stringify(seedSession.messages),
        seedSession.agreedTerms ? JSON.stringify(seedSession.agreedTerms) : null,
        seedSession.escrowId ?? null,
        seedSession.totalRounds,
        seedSession.maxRounds,
        seedSession.createdAt,
        seedSession.updatedAt,
        seedSession.expiresAt,
        seedSession.settlementTxId ?? null,
      ]
    );

    await client.query(
      `INSERT INTO negotiation_escrows
         (id, session_id, buyer_agent_id, seller_agent_id, amount_usd, asset, chain,
          status, funded_at, released_at, dispute_reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT DO NOTHING`,
      [
        seedEscrow.id,
        seedEscrow.sessionId,
        seedEscrow.buyerAgentId,
        seedEscrow.sellerAgentId,
        seedEscrow.amountUsd,
        seedEscrow.asset,
        seedEscrow.chain,
        seedEscrow.status,
        seedEscrow.fundedAt ?? null,
        seedEscrow.releasedAt ?? null,
        seedEscrow.disputeReason ?? null,
        seedEscrow.createdAt,
      ]
    );
  } finally {
    client.release();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initStore(): Promise<void> {
  if (!process.env['DATABASE_URL']) {
    useDb = false;
    seedInMemory();
    return;
  }
  try {
    const { runMigrations } = await import('./db');
    await runMigrations();
    useDb = true;
    await seedDb();
  } catch (err) {
    console.warn('[agent-negotiation] DB unavailable, falling back to in-memory:', (err as Error).message);
    useDb = false;
    seedInMemory();
  }
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function getSession(id: string): Promise<NegotiationSession | undefined> {
  if (!useDb) return sessionMap.get(id);

  const result = await pool.query<Record<string, unknown>>(
    'SELECT * FROM negotiation_sessions WHERE id = $1',
    [id]
  );
  return result.rows[0] ? rowToSession(result.rows[0]) : undefined;
}

export async function setSession(session: NegotiationSession): Promise<void> {
  if (!useDb) {
    sessionMap.set(session.id, session);
    return;
  }

  await pool.query(
    `INSERT INTO negotiation_sessions
       (id, initiator_agent_id, responder_agent_id, subject, status,
        messages, agreed_terms, escrow_id, total_rounds, max_rounds,
        created_at, updated_at, expires_at, settlement_tx_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET
       status           = EXCLUDED.status,
       messages         = EXCLUDED.messages,
       agreed_terms     = EXCLUDED.agreed_terms,
       escrow_id        = EXCLUDED.escrow_id,
       total_rounds     = EXCLUDED.total_rounds,
       updated_at       = EXCLUDED.updated_at,
       expires_at       = EXCLUDED.expires_at,
       settlement_tx_id = EXCLUDED.settlement_tx_id`,
    [
      session.id,
      session.initiatorAgentId,
      session.responderAgentId,
      session.subject,
      session.status,
      JSON.stringify(session.messages),
      session.agreedTerms ? JSON.stringify(session.agreedTerms) : null,
      session.escrowId ?? null,
      session.totalRounds,
      session.maxRounds,
      session.createdAt,
      session.updatedAt,
      session.expiresAt,
      session.settlementTxId ?? null,
    ]
  );
}

export async function listSessions(
  filter: { agentId?: string; status?: NegotiationSession['status'] } = {}
): Promise<NegotiationSession[]> {
  if (!useDb) {
    let results = Array.from(sessionMap.values());
    if (filter.agentId) {
      results = results.filter(
        s => s.initiatorAgentId === filter.agentId || s.responderAgentId === filter.agentId
      );
    }
    if (filter.status) {
      results = results.filter(s => s.status === filter.status);
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filter.agentId) {
    conditions.push(`(initiator_agent_id = $${paramIdx} OR responder_agent_id = $${paramIdx})`);
    params.push(filter.agentId);
    paramIdx++;
  }
  if (filter.status) {
    conditions.push(`status = $${paramIdx}`);
    params.push(filter.status);
    paramIdx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM negotiation_sessions ${where} ORDER BY created_at DESC`,
    params
  );
  return result.rows.map(rowToSession);
}

// ── Escrows ───────────────────────────────────────────────────────────────────

export async function getEscrow(id: string): Promise<Escrow | undefined> {
  if (!useDb) return escrowMap.get(id);

  const result = await pool.query<Record<string, unknown>>(
    'SELECT * FROM negotiation_escrows WHERE id = $1',
    [id]
  );
  return result.rows[0] ? rowToEscrow(result.rows[0]) : undefined;
}

export async function setEscrow(escrow: Escrow): Promise<Escrow> {
  if (!useDb) {
    escrowMap.set(escrow.id, escrow);
    return escrow;
  }

  await pool.query(
    `INSERT INTO negotiation_escrows
       (id, session_id, buyer_agent_id, seller_agent_id, amount_usd, asset, chain,
        status, funded_at, released_at, dispute_reason, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       status         = EXCLUDED.status,
       funded_at      = EXCLUDED.funded_at,
       released_at    = EXCLUDED.released_at,
       dispute_reason = EXCLUDED.dispute_reason`,
    [
      escrow.id,
      escrow.sessionId,
      escrow.buyerAgentId,
      escrow.sellerAgentId,
      escrow.amountUsd,
      escrow.asset,
      escrow.chain,
      escrow.status,
      escrow.fundedAt ?? null,
      escrow.releasedAt ?? null,
      escrow.disputeReason ?? null,
      escrow.createdAt,
    ]
  );
  return escrow;
}

// Re-export NOW for use in tests / other modules that need it
export { NOW };

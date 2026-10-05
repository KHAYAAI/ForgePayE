/**
 * Escrow ledger — agent balances and the escrow money movements.
 *
 * An internal IOU ledger, not on-chain settlement: balances are credited
 * only by the admin deposit route, and no code path moves real USDC/USDT.
 *
 * Source of truth:
 *   - with a database (always, in production): Postgres. Every movement is
 *     one transaction — a conditional escrow status change (… WHERE status =
 *     expected), the balance change and the ledger entry commit together or
 *     not at all. Balances used to live in a Map that was written to
 *     Postgres but never read back, so a restart zeroed every balance while
 *     escrows stayed 'funded'; and the status check and the write were
 *     separate steps, so two concurrent releases could both pay the seller.
 *   - without one (development and tests): in memory, each movement applied
 *     synchronously after a synchronous status check, so nothing interleaves.
 */
import { randomUUID } from 'node:crypto';
import { pool, isLedgerDbReady } from './db';
import { memoryEscrow, putMemoryEscrow, rowToEscrow } from './store';
import type { Escrow, LedgerAction, LedgerEntry } from './types';

// ── In-memory state (development / tests only) ───────────────────────────────

const balances = new Map<string, number>();
const entries: LedgerEntry[] = [];

function memEntry(action: LedgerAction, escrowId: string | null, fromAgentId: string | null, toAgentId: string | null, amountUsd: number): LedgerEntry {
  const entry: LedgerEntry = { id: randomUUID(), action, escrowId, fromAgentId, toAgentId, amountUsd, createdAt: new Date().toISOString() };
  entries.push(entry);
  return entry;
}

function rowToEntry(r: Record<string, unknown>): LedgerEntry {
  return {
    id: r['id'] as string, action: r['action'] as LedgerAction,
    escrowId: (r['escrow_id'] as string | null) ?? null,
    fromAgentId: (r['from_agent_id'] as string | null) ?? null,
    toAgentId: (r['to_agent_id'] as string | null) ?? null,
    amountUsd: Number(r['amount_usd']),
    createdAt: new Date(r['created_at'] as string).toISOString(),
  };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function getBalance(agentId: string): Promise<number> {
  if (!isLedgerDbReady()) return balances.get(agentId) ?? 0;
  const r = await pool.query<{ balance_usd: string }>('SELECT balance_usd FROM negotiation_agent_balances WHERE agent_id = $1', [agentId]);
  return r.rows[0] ? Number(r.rows[0].balance_usd) : 0;
}

/** Full audit trail, oldest first. Pass an agentId to filter to entries that touched that agent. */
export async function getLedgerEntries(agentId?: string): Promise<LedgerEntry[]> {
  if (!isLedgerDbReady()) {
    const all = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return agentId ? all.filter((e) => e.fromAgentId === agentId || e.toAgentId === agentId) : all;
  }
  const r = agentId
    ? await pool.query<Record<string, unknown>>(
        'SELECT * FROM negotiation_ledger_entries WHERE from_agent_id = $1 OR to_agent_id = $1 ORDER BY created_at, id', [agentId])
    : await pool.query<Record<string, unknown>>('SELECT * FROM negotiation_ledger_entries ORDER BY created_at, id');
  return r.rows.map(rowToEntry);
}

// ── Deposit (admin only — see module comment) ────────────────────────────────

export interface DepositResult {
  agentId:    string;
  balanceUsd: number;
  entry:      LedgerEntry;
}

export async function deposit(agentId: string, amountUsd: number): Promise<DepositResult> {
  if (!isLedgerDbReady()) {
    const next = (balances.get(agentId) ?? 0) + amountUsd;
    balances.set(agentId, next);
    return { agentId, balanceUsd: next, entry: memEntry('deposit', null, null, agentId, amountUsd) };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bal = await client.query<{ balance_usd: string }>(
      `INSERT INTO negotiation_agent_balances (agent_id, balance_usd, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (agent_id) DO UPDATE SET balance_usd = negotiation_agent_balances.balance_usd + EXCLUDED.balance_usd, updated_at = NOW()
       RETURNING balance_usd`, [agentId, amountUsd]);
    const e = await client.query<Record<string, unknown>>(
      `INSERT INTO negotiation_ledger_entries (id, action, escrow_id, from_agent_id, to_agent_id, amount_usd, created_at)
       VALUES ($1, 'deposit', NULL, NULL, $2, $3, NOW()) RETURNING *`, [randomUUID(), agentId, amountUsd]);
    await client.query('COMMIT');
    return { agentId, balanceUsd: Number(bal.rows[0]!.balance_usd), entry: rowToEntry(e.rows[0]!) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Escrow movements ──────────────────────────────────────────────────────────

export type Movement = 'fund' | 'release' | 'refund';

const MOVES: Record<Movement, { from: Escrow['status']; to: Escrow['status']; action: LedgerAction; stamp: 'fundedAt' | 'releasedAt' | 'refundedAt'; column: string }> = {
  fund:    { from: 'pending', to: 'funded',   action: 'lock',    stamp: 'fundedAt',   column: 'funded_at' },
  release: { from: 'funded',  to: 'released', action: 'release', stamp: 'releasedAt', column: 'released_at' },
  refund:  { from: 'funded',  to: 'refunded', action: 'refund',  stamp: 'refundedAt', column: 'refunded_at' },
};

export type MoveResult = { ok: true; escrow: Escrow } | { ok: false; error: string };

/**
 * Fund (buyer → escrow), release (escrow → seller) or refund (escrow →
 * buyer), all or nothing. Only an escrow in the expected status moves, so a
 * second release, a refund after a release, or a double-fund is refused
 * without touching any balance.
 */
export async function moveEscrow(escrowId: string, movement: Movement): Promise<MoveResult> {
  const m = MOVES[movement];
  return isLedgerDbReady() ? moveInDb(escrowId, m) : moveInMemory(escrowId, m);
}

function agentFor(escrow: Escrow, m: typeof MOVES[Movement]): string {
  return m.action === 'release' ? escrow.sellerAgentId : escrow.buyerAgentId;
}

function moveInMemory(escrowId: string, m: typeof MOVES[Movement]): MoveResult {
  // No awaits below: check and apply happen in one turn of the event loop.
  const escrow = memoryEscrow(escrowId);
  if (!escrow) return { ok: false, error: `Escrow ${escrowId} not found` };
  if (escrow.status !== m.from) return { ok: false, error: `Escrow cannot move to ${m.to} — current status: ${escrow.status}` };
  const agent = agentFor(escrow, m);
  const current = balances.get(agent) ?? 0;
  if (m.action === 'lock') {
    if (current < escrow.amountUsd) {
      return { ok: false, error: `Insufficient balance for agent ${agent}: has ${current.toFixed(2)}, needs ${escrow.amountUsd.toFixed(2)}` };
    }
    balances.set(agent, current - escrow.amountUsd);
    memEntry('lock', escrow.id, agent, null, escrow.amountUsd);
  } else {
    balances.set(agent, current + escrow.amountUsd);
    memEntry(m.action, escrow.id, null, agent, escrow.amountUsd);
  }
  const updated: Escrow = { ...escrow, status: m.to, [m.stamp]: new Date().toISOString() };
  putMemoryEscrow(updated);
  return { ok: true, escrow: updated };
}

async function moveInDb(escrowId: string, m: typeof MOVES[Movement]): Promise<MoveResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const moved = await client.query<Record<string, unknown>>(
      `UPDATE negotiation_escrows SET status = $2, ${m.column} = NOW() WHERE id = $1 AND status = $3 RETURNING *`,
      [escrowId, m.to, m.from]);
    if (moved.rowCount !== 1) {
      await client.query('ROLLBACK');
      const cur = await pool.query<{ status: string }>('SELECT status FROM negotiation_escrows WHERE id = $1', [escrowId]);
      return cur.rows[0]
        ? { ok: false, error: `Escrow cannot move to ${m.to} — current status: ${cur.rows[0].status}` }
        : { ok: false, error: `Escrow ${escrowId} not found` };
    }
    const escrow = rowToEscrow(moved.rows[0]!);
    const agent = agentFor(escrow, m);
    if (m.action === 'lock') {
      const debit = await client.query(
        `UPDATE negotiation_agent_balances SET balance_usd = balance_usd - $2, updated_at = NOW()
         WHERE agent_id = $1 AND balance_usd >= $2`, [agent, escrow.amountUsd]);
      if (debit.rowCount !== 1) {
        await client.query('ROLLBACK');
        return { ok: false, error: `Insufficient balance for agent ${agent}: needs ${escrow.amountUsd.toFixed(2)}` };
      }
    } else {
      await client.query(
        `INSERT INTO negotiation_agent_balances (agent_id, balance_usd, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (agent_id) DO UPDATE SET balance_usd = negotiation_agent_balances.balance_usd + EXCLUDED.balance_usd, updated_at = NOW()`,
        [agent, escrow.amountUsd]);
    }
    await client.query(
      `INSERT INTO negotiation_ledger_entries (id, action, escrow_id, from_agent_id, to_agent_id, amount_usd, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [randomUUID(), m.action, escrow.id, m.action === 'lock' ? agent : null, m.action === 'lock' ? null : agent, escrow.amountUsd]);
    await client.query('COMMIT');
    return { ok: true, escrow };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Test/dev helper ────────────────────────────────────────────────────────────

/** Clears all in-memory ledger state. Test-only. */
export function resetLedger(): void {
  balances.clear();
  entries.length = 0;
}

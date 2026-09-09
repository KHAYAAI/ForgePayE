/**
 * Outbound USDC payouts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this exists
 *
 * Until now this gateway only ever received money. Deposits, x402 payments,
 * shielded deposits — all inbound. The credit bureau owes its data furnishers a
 * 25% share of every paid inquiry and had no way to pay it: the attribution is
 * computed, the amount is known, and there was no rail. Paying a furnisher is
 * the x402 top-up flow run in reverse, and this is that reverse.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The three properties that matter more than features
 *
 *   1. IDEMPOTENT. A payout carries a caller-supplied `external_id` unique per
 *      requester. Re-submitting the same one returns the original payout rather
 *      than sending a second time. Outbound money is the one place where an
 *      ordinary retry — a client timeout, a redeployed worker — becomes an
 *      unrecoverable loss, so deduplication is a property of the schema
 *      (a unique index) rather than of the handler's good intentions.
 *
 *   2. APPROVAL-GATED ABOVE A THRESHOLD. Small automated payouts settle without
 *      a human; anything above PAYOUT_AUTO_APPROVE_MAX_USD requires an explicit
 *      approval before it can be submitted. The same shape custody already uses:
 *      policy is evaluated before anything cryptographic happens.
 *
 *   3. NEVER SIMULATED IN PRODUCTION. If no signer is configured, a payout is
 *      refused outright rather than recorded as sent. This follows the
 *      precedent yield-engine set in simulation-guard.ts — a production system
 *      quietly logging money movements that never happened is worse than one
 *      that stops.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What is deliberately NOT here
 *
 * There is no live transaction signing in this module. `submitPayout` calls a
 * `PayoutBroadcaster`, and the only broadcaster wired today refuses to run in
 * production. Building an unattended signer that can drain a hot wallet is not
 * something to land alongside a pricing change; it needs its own key custody
 * decision, its own review, and its own limits. The ledger, the idempotency and
 * the approval gate are the parts that are safe to have first, and they are the
 * parts the bureau needs in order to owe money accurately.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { logger } from './logger.js';

// ── Configuration ─────────────────────────────────────────────────────────────

/** Payouts at or below this settle without human approval. */
export const PAYOUT_AUTO_APPROVE_MAX_USD = Number(
  process.env['PAYOUT_AUTO_APPROVE_MAX_USD'] ?? '100',
);

/** Hard ceiling. No payout above this is accepted at all, approved or not. */
export const PAYOUT_ABSOLUTE_MAX_USD = Number(
  process.env['PAYOUT_ABSOLUTE_MAX_USD'] ?? '25000',
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type PayoutStatus =
  | 'pending_approval'
  | 'approved'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'rejected';

export interface Payout {
  id: string;
  /** Caller's own id for this payout. Unique per requester — the idempotency key. */
  externalId: string;
  /** Who is being paid — a bureau contributor id, or any platform principal. */
  payeeId: string;
  payeeAddress: string;
  chain: string;
  amountUsdc: number;
  status: PayoutStatus;
  reason: string;
  requestedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  txHash?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Broadcaster seam ──────────────────────────────────────────────────────────

export interface BroadcastResult {
  txHash: string;
}

export interface PayoutBroadcaster {
  name: string;
  broadcast(payout: Payout): Promise<BroadcastResult>;
}

export class PayoutsNotConfiguredError extends Error {
  constructor() {
    super(
      'No outbound signer is configured. Refusing to record a payout as sent when nothing ' +
      'was broadcast — set PAYOUT_SIGNER to enable outbound transfers.',
    );
    this.name = 'PayoutsNotConfiguredError';
  }
}

/**
 * The only broadcaster wired today.
 *
 * Development gets a deterministic fake hash so the lifecycle above it can be
 * exercised end to end. Production gets an exception. The distinction is
 * deliberate and load-bearing: a simulated payout that reaches a furnisher
 * statement as "sent" is a false record of a payment that never happened, which
 * is worse for the bureau's credibility than having no rail at all.
 */
export class UnconfiguredBroadcaster implements PayoutBroadcaster {
  name = 'unconfigured';

  async broadcast(payout: Payout): Promise<BroadcastResult> {
    if (process.env['NODE_ENV'] === 'production') {
      throw new PayoutsNotConfiguredError();
    }
    logger.warn(
      { payoutId: payout.id, amountUsdc: payout.amountUsdc },
      '[payouts] simulating broadcast — no signer configured (development only)',
    );
    return { txHash: `0xsimulated_payout_${payout.id.replace(/-/g, '').slice(0, 24)}` };
  }
}

let broadcaster: PayoutBroadcaster = new UnconfiguredBroadcaster();

/** Swap the broadcaster — used by tests, and by a future real signer. */
export function setPayoutBroadcaster(next: PayoutBroadcaster): void {
  broadcaster = next;
}

export function currentBroadcaster(): PayoutBroadcaster {
  return broadcaster;
}

// ── Validation ────────────────────────────────────────────────────────────────

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type PayoutRequestError =
  | { field: 'amount_usdc'; message: string }
  | { field: 'payee_address'; message: string }
  | { field: 'external_id'; message: string };

export function validatePayoutRequest(input: {
  externalId: string;
  payeeAddress: string;
  amountUsdc: number;
}): PayoutRequestError | null {
  if (!input.externalId || input.externalId.length > 200) {
    return { field: 'external_id', message: 'external_id is required and must be at most 200 characters' };
  }
  if (!EVM_ADDRESS.test(input.payeeAddress)) {
    return { field: 'payee_address', message: 'payee_address must be a 0x-prefixed 20-byte EVM address' };
  }
  if (!Number.isFinite(input.amountUsdc) || input.amountUsdc <= 0) {
    return { field: 'amount_usdc', message: 'amount_usdc must be a positive number' };
  }
  if (input.amountUsdc > PAYOUT_ABSOLUTE_MAX_USD) {
    return {
      field: 'amount_usdc',
      message: `amount_usdc exceeds the absolute ceiling of $${PAYOUT_ABSOLUTE_MAX_USD}`,
    };
  }
  return null;
}

/** Whether this amount can skip human approval. */
export function requiresApproval(amountUsdc: number): boolean {
  return amountUsdc > PAYOUT_AUTO_APPROVE_MAX_USD;
}

// ── Persistence ───────────────────────────────────────────────────────────────

interface PayoutRow {
  id: string;
  external_id: string;
  payee_id: string;
  payee_address: string;
  chain: string;
  amount_usdc: string;
  status: PayoutStatus;
  reason: string;
  requested_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  tx_hash: string | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToPayout(row: PayoutRow): Payout {
  return {
    id: row.id,
    externalId: row.external_id,
    payeeId: row.payee_id,
    payeeAddress: row.payee_address,
    chain: row.chain,
    amountUsdc: Number(row.amount_usdc),
    status: row.status,
    reason: row.reason,
    requestedBy: row.requested_by,
    ...(row.approved_by ? { approvedBy: row.approved_by } : {}),
    ...(row.approved_at ? { approvedAt: row.approved_at.toISOString() } : {}),
    ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
    ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CreatePayoutInput {
  externalId: string;
  payeeId: string;
  payeeAddress: string;
  chain: string;
  amountUsdc: number;
  reason: string;
  requestedBy: string;
}

export interface CreatePayoutResult {
  payout: Payout;
  /** True when this external_id already existed and nothing new was created. */
  deduplicated: boolean;
}

/**
 * Create a payout, or return the existing one for this `external_id`.
 *
 * The `ON CONFLICT DO NOTHING` plus follow-up select is the whole idempotency
 * guarantee, and it is done in the database rather than by checking first:
 * a check-then-insert races against a concurrent retry of the same payout, and
 * the loser of that race sends money twice.
 */
export async function createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
  const db = getDb();
  const id = randomUUID();
  const status: PayoutStatus = requiresApproval(input.amountUsdc) ? 'pending_approval' : 'approved';

  const inserted = await db.query<PayoutRow>(
    `INSERT INTO payouts
       (id, external_id, payee_id, payee_address, chain, amount_usdc, status, reason, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (requested_by, external_id) DO NOTHING
     RETURNING *`,
    [id, input.externalId, input.payeeId, input.payeeAddress, input.chain,
     input.amountUsdc, status, input.reason, input.requestedBy],
  );

  if (inserted.rows.length > 0) {
    return { payout: rowToPayout(inserted.rows[0]), deduplicated: false };
  }

  const existing = await db.query<PayoutRow>(
    `SELECT * FROM payouts WHERE requested_by = $1 AND external_id = $2`,
    [input.requestedBy, input.externalId],
  );
  return { payout: rowToPayout(existing.rows[0]), deduplicated: true };
}

export async function getPayout(id: string): Promise<Payout | null> {
  const db = getDb();
  const result = await db.query<PayoutRow>(`SELECT * FROM payouts WHERE id = $1`, [id]);
  return result.rows[0] ? rowToPayout(result.rows[0]) : null;
}

export async function listPayouts(filter: { payeeId?: string; status?: PayoutStatus } = {}): Promise<Payout[]> {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.payeeId) { params.push(filter.payeeId); clauses.push(`payee_id = $${params.length}`); }
  if (filter.status)  { params.push(filter.status);  clauses.push(`status = $${params.length}`); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await db.query<PayoutRow>(
    `SELECT * FROM payouts ${where} ORDER BY created_at DESC LIMIT 500`, params,
  );
  return result.rows.map(rowToPayout);
}

export type ApproveResult =
  | { ok: true; payout: Payout }
  | { ok: false; reason: 'not_found' | 'not_pending'; status: PayoutStatus | null };

/**
 * Approve a payout awaiting a human.
 *
 * The status guard is in the WHERE clause, not in a prior read: approving an
 * already-submitted payout must be impossible even if two approvers click at
 * the same moment.
 */
export async function approvePayout(id: string, approvedBy: string): Promise<ApproveResult> {
  const db = getDb();
  const result = await db.query<PayoutRow>(
    `UPDATE payouts
        SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'pending_approval'
      RETURNING *`,
    [id, approvedBy],
  );
  if (result.rows.length > 0) return { ok: true, payout: rowToPayout(result.rows[0]) };

  const current = await getPayout(id);
  return current
    ? { ok: false, reason: 'not_pending', status: current.status }
    : { ok: false, reason: 'not_found', status: null };
}

export async function rejectPayout(id: string, rejectedBy: string, reason: string): Promise<ApproveResult> {
  const db = getDb();
  const result = await db.query<PayoutRow>(
    `UPDATE payouts
        SET status = 'rejected', approved_by = $2, failure_reason = $3, updated_at = NOW()
      WHERE id = $1 AND status = 'pending_approval'
      RETURNING *`,
    [id, rejectedBy, reason],
  );
  if (result.rows.length > 0) return { ok: true, payout: rowToPayout(result.rows[0]) };

  const current = await getPayout(id);
  return current
    ? { ok: false, reason: 'not_pending', status: current.status }
    : { ok: false, reason: 'not_found', status: null };
}

export type SubmitResult =
  | { ok: true; payout: Payout; alreadySubmitted: boolean }
  | { ok: false; reason: 'not_found' | 'not_approved' | 'broadcast_failed'; status: PayoutStatus | null; message?: string };

/**
 * Broadcast an approved payout.
 *
 * The claim-then-broadcast ordering is the important part. The row is moved to
 * `submitted` in a conditional UPDATE *before* anything is sent, so a second
 * caller racing the first finds nothing to claim and cannot broadcast the same
 * payout again. If the broadcast then fails the row is marked `failed` with the
 * reason — deliberately not returned to `approved`, because a transfer that
 * errored may still have landed on-chain, and silently re-arming it for another
 * attempt is how a double-send happens.
 */
export async function submitPayout(id: string): Promise<SubmitResult> {
  const db = getDb();

  const claimed = await db.query<PayoutRow>(
    `UPDATE payouts SET status = 'submitted', updated_at = NOW()
      WHERE id = $1 AND status = 'approved'
      RETURNING *`,
    [id],
  );

  if (claimed.rows.length === 0) {
    const current = await getPayout(id);
    if (!current) return { ok: false, reason: 'not_found', status: null };
    if (current.status === 'submitted' || current.status === 'confirmed') {
      return { ok: true, payout: current, alreadySubmitted: true };
    }
    return { ok: false, reason: 'not_approved', status: current.status };
  }

  const payout = rowToPayout(claimed.rows[0]);

  try {
    const { txHash } = await broadcaster.broadcast(payout);
    const confirmed = await db.query<PayoutRow>(
      `UPDATE payouts SET status = 'confirmed', tx_hash = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id, txHash],
    );
    logger.info({ payoutId: id, txHash, amountUsdc: payout.amountUsdc }, '[payouts] payout confirmed');
    return { ok: true, payout: rowToPayout(confirmed.rows[0]), alreadySubmitted: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.query(
      `UPDATE payouts SET status = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1`,
      [id, message],
    );
    logger.error({ payoutId: id, err: message }, '[payouts] broadcast failed — payout marked failed, not retried');
    return { ok: false, reason: 'broadcast_failed', status: 'failed', message };
  }
}

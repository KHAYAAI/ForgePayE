/**
 * Paying furnishers what the attribution ledger says they are owed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The gap this closes
 *
 * furnisher-comp.ts computes, per inquiry, exactly what each furnisher earned,
 * and writes an AttributionEntry for it. Nothing ever paid those entries. The
 * bureau knew what it owed to the cent and had no path from that number to a
 * transfer, which is the least defensible state for a revenue share to be in:
 * the promise is published, the arithmetic is right, and the money never moves.
 *
 * stablecoin-gateway now exposes an outbound payout rail. This is the bureau's
 * side of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Accrue per inquiry, pay per period
 *
 * A single inquiry's share is cents — often a fraction of one. Broadcasting a
 * transfer per inquiry would spend more on gas than it moves. So entries accrue
 * individually (they must, for disputes to reverse precisely) and settle in
 * batches: one payout per furnisher per period, summing every unsettled
 * cash-phase entry it earned.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why an open period must never be settled
 *
 * The idempotency key sent to the gateway is `furnisher_<contributor>_<period>`,
 * and the gateway deduplicates on it — a second payout under the same key is
 * refused and returns the first one.
 *
 * That is the correct behaviour for a retry, and a trap for an early run. If a
 * period is settled while it is still open, the entries accrued after that run
 * belong to a period whose key is already spent: the next attempt returns
 * `deduplicated: true`, pays nothing, and those entries are owed forever with
 * no error anywhere. The dedup guarantee that makes retries safe is exactly
 * what makes a premature run lossy.
 *
 * So `settleFurnisherPeriod` refuses any period that has not ended. It is a cheap check
 * standing in front of a silent, permanent underpayment.
 */

import { randomUUID } from 'crypto';
import type { AttributionEntry, DataContributor } from './types';
import {
  listAttributions, recordAttribution, getContributor, contributors,
} from './store';

// ── Periods ───────────────────────────────────────────────────────────────────

/** The settlement period a timestamp falls in, as `YYYY-MM`. */
export function payoutPeriod(when: Date | string = new Date()): string {
  const d = typeof when === 'string' ? new Date(when) : when;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The period immediately before the one `now` falls in — the newest settleable one. */
export function previousPeriod(now: Date = new Date()): string {
  return payoutPeriod(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

/**
 * Whether `period` has finished, and is therefore safe to settle.
 *
 * See the header: settling an open period silently strands every entry accrued
 * after the run, because the gateway will deduplicate the second attempt.
 */
export function isPeriodClosed(period: string, now: Date = new Date()): boolean {
  return period < payoutPeriod(now);
}

// ── What is owed ──────────────────────────────────────────────────────────────

/**
 * The unsettled cash-phase entries a furnisher earned in a period.
 *
 * Reversed entries are excluded: a dispute that overturned an attribution must
 * not then pay for it. Reciprocity-phase entries are excluded because they were
 * never cash — they credited the furnisher's inquiry balance at accrual time,
 * and paying them again here would compensate the same contribution twice.
 */
export function unsettledEntriesFor(contributorId: string, period: string): AttributionEntry[] {
  return listAttributions().filter(e =>
    e.contributorId === contributorId &&
    e.phase === 'cash' &&
    e.amountUsdCents > 0 &&
    !e.reversedAt &&
    !e.settlementId &&
    payoutPeriod(e.createdAt) === period,
  );
}

export interface OwedLine {
  contributorId: string;
  contributorName: string;
  period: string;
  entryCount: number;
  amountUsdCents: number;
  amountUsd: number;
  payoutAddress?: string;
  /** Set when this line cannot be paid; the run reports it rather than skipping it. */
  blocked?: 'no_payout_address' | 'contributor_suspended';
}

function toLine(c: DataContributor, period: string, entries: AttributionEntry[]): OwedLine {
  const cents = entries.reduce((sum, e) => sum + e.amountUsdCents, 0);
  const blocked =
    !c.payoutAddress ? 'no_payout_address' as const
    : c.status === 'suspended' ? 'contributor_suspended' as const
    : undefined;
  return {
    contributorId: c.id,
    contributorName: c.name,
    period,
    entryCount: entries.length,
    amountUsdCents: cents,
    amountUsd: cents / 100,
    ...(c.payoutAddress ? { payoutAddress: c.payoutAddress } : {}),
    ...(blocked ? { blocked } : {}),
  };
}

/** Everything owed for a period, payable or not. The dry run behind every settlement. */
export function previewPeriod(period: string): OwedLine[] {
  const lines: OwedLine[] = [];
  for (const c of contributors.values()) {
    const entries = unsettledEntriesFor(c.id, period);
    if (entries.length === 0) continue;
    lines.push(toLine(c, period, entries));
  }
  return lines.sort((a, b) => b.amountUsdCents - a.amountUsdCents);
}

// ── The gateway's payout rail ─────────────────────────────────────────────────
//
// Same fail-closed convention as billing.ts's top-up client: an unset
// STABLECOIN_GATEWAY_URL means settlement is unavailable, never silently
// skipped. There is no "pay anyway" reading of a missing payment rail.

function gatewayUrl(): string | undefined {
  return process.env['STABLECOIN_GATEWAY_URL'];
}

const DEFAULT_CHAIN = process.env['FURNISHER_PAYOUT_CHAIN'] ?? 'base';

interface GatewayPayoutResponse {
  data: { id: string; status: string; amount_usdc?: number };
  deduplicated: boolean;
  requires_approval: boolean;
}

/**
 * The idempotency key for one furnisher's period.
 *
 * Deterministic by construction — the same furnisher and period always produce
 * the same key, so a retried or duplicated run cannot pay twice. This is the
 * value the header's warning is about.
 */
export function payoutExternalId(contributorId: string, period: string): string {
  return `furnisher_${contributorId}_${period}`;
}

// ── Running a settlement ──────────────────────────────────────────────────────

export interface SettledLine extends OwedLine {
  payoutId?: string;
  payoutStatus?: string;
  /** True when the gateway already had this payout — a retry, not a second transfer. */
  deduplicated?: boolean;
  requiresApproval?: boolean;
  error?: string;
}

export type FurnisherSettlementRun =
  | {
      ok: true;
      settlementId: string;
      period: string;
      lines: SettledLine[];
      totalPaidUsdCents: number;
      blockedCount: number;
      failedCount: number;
    }
  | {
      ok: false;
      reason: 'not_configured' | 'period_open';
      message: string;
    };

/**
 * Settle one closed period: one payout per furnisher with cash owed.
 *
 * Entries are marked settled only after the gateway has accepted the payout. If
 * the call fails the entries stay unsettled and the next run retries them under
 * the same idempotency key, which is safe precisely because the key is stable —
 * a payout that did land despite an error surfaces as `deduplicated` rather
 * than as a second transfer.
 */
export async function settleFurnisherPeriod(period: string, now: Date = new Date()): Promise<FurnisherSettlementRun> {
  const base = gatewayUrl();
  if (!base) {
    return {
      ok: false, reason: 'not_configured',
      message: 'STABLECOIN_GATEWAY_URL is not set — furnisher settlement is unavailable.',
    };
  }
  if (!isPeriodClosed(period, now)) {
    return {
      ok: false, reason: 'period_open',
      message:
        `Period ${period} has not ended. Settling it now would spend its idempotency key ` +
        `on a partial total, and every entry accrued afterwards would be silently unpayable. ` +
        `Settle it after it closes.`,
    };
  }

  const settlementId = randomUUID();
  const root = base.replace(/\/$/, '');
  const lines: SettledLine[] = [];
  let totalPaid = 0;
  let blocked = 0;
  let failed = 0;

  for (const line of previewPeriod(period)) {
    if (line.blocked) {
      blocked++;
      lines.push(line);
      continue;
    }

    const entries = unsettledEntriesFor(line.contributorId, period);
    // Re-derived rather than trusting the preview's total: the two must agree,
    // and the amount actually sent is the one computed from the entries that
    // are about to be marked settled.
    const cents = entries.reduce((sum, e) => sum + e.amountUsdCents, 0);
    if (cents <= 0) continue;

    const contributor = getContributor(line.contributorId);
    try {
      const res = await fetch(`${root}/payouts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forge-service': 'agent-credit-bureau' },
        body: JSON.stringify({
          external_id:   payoutExternalId(line.contributorId, period),
          payee_id:      line.contributorId,
          payee_address: line.payoutAddress,
          chain:         contributor?.payoutChain ?? DEFAULT_CHAIN,
          amount_usdc:   cents / 100,
          reason:        `Furnisher revenue share — ${line.contributorName}, ${period} (${entries.length} inquiries)`,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        failed++;
        lines.push({ ...line, error: `gateway returned ${res.status}` });
        continue;
      }

      const body = await res.json() as GatewayPayoutResponse;

      // Only now are the entries considered paid. Marking them before the
      // gateway accepted would lose the debt if the call failed.
      const settledAt = now.toISOString();
      for (const e of entries) {
        recordAttribution({ ...e, settlementId, settledAt });
      }

      totalPaid += cents;
      lines.push({
        ...line,
        payoutId: body.data.id,
        payoutStatus: body.data.status,
        deduplicated: body.deduplicated,
        requiresApproval: body.requires_approval,
      });
    } catch (err) {
      failed++;
      lines.push({ ...line, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    ok: true,
    settlementId,
    period,
    lines,
    totalPaidUsdCents: totalPaid,
    blockedCount: blocked,
    failedCount: failed,
  };
}

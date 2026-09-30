/**
 * Sending approved payouts, and finishing the ones that were interrupted.
 *
 * The bureau creates payouts; a person approves the large ones; something has to
 * actually send them, or a furnisher's share is owed and never paid. This is that
 * something. Each pass it
 *
 *   1. reconciles payouts left 'submitted' too long — looking up the transaction the
 *      ledger recorded at send time and closing the payout on what the chain says;
 *   2. sends 'approved' payouts, oldest first, one at a time.
 *
 * What it will NOT do is re-send. A payout that was claimed but has no transaction hash
 * (the process died between claiming it and sending) might or might not have gone out,
 * and sending again is how a furnisher is paid twice. Those are marked failed, with the
 * reason, for a person to check against the signing wallet's outgoing transfers. The
 * window is a few milliseconds, but it exists, and the honest handling is to say so.
 *
 * Small payouts (under PAYOUT_AUTO_APPROVE_MAX_USD) are approved at creation and so are
 * sent here without anyone looking at them; anything larger waits for a human approval
 * first, and is sent here only after that. The signer's own daily ceiling still applies.
 *
 * Runs only when a real signer is installed. With none, nothing is sent and nothing is
 * pretended.
 */

import {
  currentBroadcaster, listStaleSubmitted, listApprovedIds, settleInFlight, submitPayout,
} from './payouts.js';

export interface WorkerPassResult { reconciled: number; stillPending: number; submitted: number; failed: number }

export interface WorkerOptions {
  /** A 'submitted' payout older than this is checked against the chain (default 2 minutes). */
  staleAfterMs?: number;
  /** At most this many payouts sent per pass (default 25). */
  batch?: number;
}

export async function payoutWorkerPass(opts: WorkerOptions = {}): Promise<WorkerPassResult> {
  const out: WorkerPassResult = { reconciled: 0, stillPending: 0, submitted: 0, failed: 0 };
  const broadcaster = currentBroadcaster();
  if (broadcaster.name === 'unconfigured') return out;

  for (const p of await listStaleSubmitted(opts.staleAfterMs ?? 120_000)) {
    if (!p.txHash) {
      if (await settleInFlight(p.id, 'failed',
        'Interrupted after the payout was claimed and before any transaction hash was recorded. It may or may not have been sent: ' +
        "check the signing wallet's outgoing transfers before re-issuing. Not retried automatically, because a retry could pay twice.")) out.reconciled++;
      continue;
    }
    if (!broadcaster.reconcile) { out.stillPending++; continue; }
    try {
      const state = await broadcaster.reconcile(p);
      if (state === 'pending') { out.stillPending++; continue; }
      if (await settleInFlight(p.id, state, state === 'failed' ? `transaction ${p.txHash} reverted on-chain` : undefined)) out.reconciled++;
    } catch (err) {
      console.error(`[payout-worker] could not reconcile payout ${p.id}:`, err instanceof Error ? err.message : err);
      out.stillPending++;
    }
  }

  for (const id of await listApprovedIds(opts.batch ?? 25)) {
    const r = await submitPayout(id);
    if (r.ok) out.submitted++;
    else if (r.reason === 'broadcast_failed') {
      out.failed++;
      // The signer refused or the send failed. The payout is now 'failed' with the reason; carry on with the rest.
      console.error(`[payout-worker] payout ${id} failed: ${r.message}`);
    }
  }
  return out;
}

export interface WorkerHandle { stop(): void }

/** Run the worker on an interval. Passes never overlap; a failing pass is logged and retried next tick. */
export function startPayoutWorker(intervalMs: number, opts: WorkerOptions = {}): WorkerHandle {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await payoutWorkerPass(opts);
      if (r.submitted || r.reconciled || r.failed) console.log('[payout-worker]', JSON.stringify(r));
    } catch (err) {
      console.error('[payout-worker] pass failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  void tick();
  return { stop: () => clearInterval(timer) };
}

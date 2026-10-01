/**
 * The watchdog turns the gateway's database state into alerts. It reads state rather than counting
 * events in the workers, so a condition is raised while it is true and resolved when it clears, and it
 * still fires after a restart.
 *
 *   treasury shortfall      the payout wallet can't be funded for approved payouts            critical
 *   payouts waiting         approved payouts not sent for too long                            critical
 *   failed payouts          payouts that failed and nobody has dealt with                     critical
 *   failed sweeps           deposit sweeps stuck in 'failed' (funds sit in a deposit address) warning
 *   exchange rate stale     the USD/ZAR rate is close to / past its maximum age               warning/critical
 *   assets not verified     a stablecoin the gateway should accept failed its on-chain check   critical
 */
import type { Alerter } from './alerts.js';

export interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, any>> }> }

export interface WatchdogOptions {
  payoutWaitMinutes?: number;   // default 15
  fxMaxAgeHours?: number;       // default FX_MAX_AGE_HOURS or 24
  assetsVerified?: () => boolean;
  now?: () => number;
}

export async function runWatchdogOnce(db: Queryable, alerter: Alerter, opts: WatchdogOptions = {}): Promise<void> {
  const now = opts.now?.() ?? Date.now();
  const steps: Array<() => Promise<void>> = [
    async () => {
      const r = await db.query(`SELECT value FROM treasury_state WHERE key = 'shortfalls'`);
      const s = (r.rows[0]?.value ?? []) as Array<{ asset: string; short_units: string; short_usd: number; reason: string }>;
      if (s.length) await alerter.raise('treasury:shortfall', 'critical', 'Treasury cannot cover payouts',
        s.map((x) => `${x.asset}: short by ${x.short_units} units${x.short_usd ? ` (~$${x.short_usd})` : ''} — ${x.reason}`).join('\n'));
      else await alerter.resolve('treasury:shortfall', 'the treasury can cover approved payouts again');
    },
    async () => {
      const minutes = opts.payoutWaitMinutes ?? 15;
      const r = await db.query(
        `SELECT COUNT(*)::int AS n, COALESCE(MIN(approved_at), MIN(created_at)) AS oldest FROM payouts
          WHERE status = 'approved' AND COALESCE(approved_at, created_at) < to_timestamp($1)`, [(now - minutes * 60_000) / 1000]);
      const n = Number(r.rows[0]?.n ?? 0);
      if (n > 0) await alerter.raise('payouts:waiting', 'critical', `${n} approved payout(s) not sent for over ${minutes} minutes`,
        `Oldest approved ${new Date(r.rows[0]!['oldest']).toISOString()}. Check the payout worker, the signer, and whether the payout wallet is funded.`);
      else await alerter.resolve('payouts:waiting');
    },
    async () => {
      const r = await db.query(`SELECT COUNT(*)::int AS n, MAX(failure_reason) AS why FROM payouts WHERE status = 'failed'`);
      const n = Number(r.rows[0]?.n ?? 0);
      if (n > 0) await alerter.raise('payouts:failed', 'critical', `${n} payout(s) in failed state`,
        `Each needs a person: a failed payout may or may not have been sent. Latest reason: ${String(r.rows[0]!['why'] ?? 'unknown').slice(0, 300)}`);
      else await alerter.resolve('payouts:failed');
    },
    async () => {
      const r = await db.query(`SELECT COUNT(*)::int AS n, MAX(error) AS why FROM deposit_sweeps WHERE status = 'failed'`);
      const n = Number(r.rows[0]?.n ?? 0);
      if (n > 0) await alerter.raise('sweeps:failed', 'warning', `${n} deposit sweep(s) failed`,
        `Funds are still in the deposit address(es). Latest error: ${String(r.rows[0]!['why'] ?? 'unknown').slice(0, 300)}`);
      else await alerter.resolve('sweeps:failed');
    },
    async () => {
      const max = opts.fxMaxAgeHours ?? Number(process.env['FX_MAX_AGE_HOURS'] ?? '24');
      const r = await db.query(`SELECT as_of FROM fx_rates WHERE pair = 'USD/ZAR' ORDER BY as_of DESC, id DESC LIMIT 1`);
      if (!r.rows[0]) return; // rand pricing not in use
      const ageH = (now - new Date(r.rows[0]['as_of']).getTime()) / 3_600_000;
      if (ageH >= max) await alerter.raise('fx:stale', 'critical', 'USD/ZAR rate is past its maximum age', `Rand-denominated payments and payouts are refused until it is refreshed (${ageH.toFixed(1)}h old, limit ${max}h).`);
      else if (ageH >= max * 0.8) await alerter.raise('fx:stale', 'warning', 'USD/ZAR rate is close to its maximum age', `${ageH.toFixed(1)}h old, limit ${max}h.`);
      else await alerter.resolve('fx:stale');
    },
    async () => {
      if (!opts.assetsVerified) return;
      if (!opts.assetsVerified()) await alerter.raise('assets:unverified', 'critical', 'A stablecoin failed its on-chain verification',
        'The gateway is refusing the affected asset. See GET /assets for which one and why.');
      else await alerter.resolve('assets:unverified');
    },
  ];
  for (const step of steps) {
    try { await step(); } catch (e) { console.error('[watchdog] check failed:', e instanceof Error ? e.message : e); }
  }
}

export function startWatchdog(db: Queryable, alerter: Alerter, intervalMs: number, opts: WatchdogOptions & { shouldRun?: () => boolean } = {}): { stop: () => void } {
  let running = false;
  const tick = async () => {
    if (running || opts.shouldRun?.() === false) return;
    running = true;
    try { await runWatchdogOnce(db, alerter, opts); } finally { running = false; }
  };
  const t = setInterval(() => { void tick(); }, intervalMs);
  t.unref?.();
  void tick();
  return { stop: () => clearInterval(t) };
}

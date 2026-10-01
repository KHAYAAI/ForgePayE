import { describe, it, expect } from 'vitest';
import { Alerter, WebhookSink, PagerDutySink, type AlertSink } from '../src/lib/alerts.js';
import { runWatchdogOnce, type Queryable } from '../src/lib/watchdog.js';

const quiet = () => {};
function recorder(name: string, accepts: (s: string) => boolean, fail = false): AlertSink & { got: string[] } {
  const got: string[] = [];
  return { name, got, accepts: accepts as any, async send(a, e) { if (fail) throw new Error('down'); got.push(`${e}:${a.key}`); } };
}

describe('alert routing', () => {
  it('sends critical to everything, warnings to the webhook only, and dedupes repeats', async () => {
    const pd = recorder('pagerduty', (s) => s === 'critical');
    const wh = recorder('webhook', (s) => s !== 'info');
    let t = 0;
    const a = new Alerter([pd, wh], { now: () => t, reminderMs: 1000, console: quiet });
    await a.raise('k1', 'critical', 'x', 'd');
    await a.raise('k1', 'critical', 'x', 'd');            // repeat: suppressed
    await a.raise('k2', 'warning', 'y', 'd');
    expect(pd.got).toEqual(['trigger:k1']);
    expect(wh.got).toEqual(['trigger:k1', 'trigger:k2']);
    t = 2000;
    await a.raise('k1', 'critical', 'x', 'd');            // reminder after the interval
    expect(pd.got).toEqual(['trigger:k1', 'trigger:k1']);
    await a.resolve('k1');
    await a.resolve('k1');                                // only once
    expect(pd.got.filter((x) => x.startsWith('resolve'))).toHaveLength(1);
  });

  it('escalating warning to critical pages immediately', async () => {
    const pd = recorder('pagerduty', (s) => s === 'critical');
    const a = new Alerter([pd], { now: () => 0, reminderMs: 1e9, console: quiet });
    await a.raise('fx', 'warning', 'x', 'd');
    await a.raise('fx', 'critical', 'x', 'd');
    expect(pd.got).toEqual(['trigger:fx']);
  });

  it('does not treat an undelivered alert as sent: it is retried, and the failure is visible', async () => {
    const bad = recorder('webhook', () => true, true);
    const a = new Alerter([bad], { now: () => 0, reminderMs: 1e9, console: quiet });
    await a.raise('k', 'critical', 't', 'd');
    await a.raise('k', 'critical', 't', 'd');
    expect(a.status().deliveryFailures).toBe(2);        // tried again rather than assuming it was sent
    expect(a.status().active[0]!.delivered).toBe(false);
    await a.resolve('k');                                // nothing was ever delivered, so no stray "resolved"
    expect(a.status().recent.filter((r) => r.event === 'resolve')).toHaveLength(0);
  });

  it('formats Slack and PagerDuty requests', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const f: any = async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, text: async () => '' }; };
    const alert = { key: 'treasury:shortfall', severity: 'critical' as const, title: 'T', detail: 'D', at: '2026-01-01T00:00:00Z', env: 'production' };
    await new WebhookSink('https://hooks.example/x', 'slack', f).send(alert, 'trigger');
    await new PagerDutySink('RK', f).send(alert, 'trigger');
    await new PagerDutySink('RK', f).send(alert, 'resolve');
    expect(calls[0]!.body.text).toContain('CRITICAL');
    expect(calls[1]!.url).toBe('https://events.pagerduty.com/v2/enqueue');
    expect(calls[1]!.body).toMatchObject({ routing_key: 'RK', event_action: 'trigger', dedup_key: 'treasury:shortfall' });
    expect(calls[2]!.body).toMatchObject({ event_action: 'resolve', dedup_key: 'treasury:shortfall' });
    const bad: any = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    await expect(new WebhookSink('https://h', 'json', bad).send(alert, 'trigger')).rejects.toThrow(/HTTP 500/);
  });
});

describe('watchdog', () => {
  function db(state: { shortfalls?: any[]; waiting?: number; failedPayouts?: number; failedSweeps?: number; fxAgeH?: number | null }): Queryable {
    return { async query(sql: string) {
      if (sql.includes('treasury_state')) return { rows: [{ value: state.shortfalls ?? [] }] };
      if (sql.includes(`status = 'approved'`)) return { rows: [{ n: state.waiting ?? 0, oldest: new Date(0) }] };
      if (sql.includes('FROM payouts') && sql.includes(`'failed'`)) return { rows: [{ n: state.failedPayouts ?? 0, why: 'broadcast failed' }] };
      if (sql.includes('deposit_sweeps')) return { rows: [{ n: state.failedSweeps ?? 0, why: 'insufficient gas' }] };
      if (sql.includes('fx_rates')) return { rows: state.fxAgeH == null ? [] : [{ as_of: new Date(Date.now() - state.fxAgeH * 3_600_000) }] };
      return { rows: [] };
    } };
  }
  it('raises treasury shortfalls, failed payouts, failed sweeps and a stale rate, then resolves them', async () => {
    const wh = recorder('webhook', (s) => s !== 'info');
    const a = new Alerter([wh], { console: quiet });
    await runWatchdogOnce(db({ shortfalls: [{ asset: 'ZARP', short_units: '5000', short_usd: 280, reason: 'operating wallet short' }], waiting: 2, failedPayouts: 1, failedSweeps: 3, fxAgeH: 30 }), a);
    expect(wh.got.sort()).toEqual(['trigger:fx:stale', 'trigger:payouts:failed', 'trigger:payouts:waiting', 'trigger:sweeps:failed', 'trigger:treasury:shortfall']);
    wh.got.length = 0;
    await runWatchdogOnce(db({ fxAgeH: 1 }), a);
    expect(wh.got.sort()).toEqual(['resolve:fx:stale', 'resolve:payouts:failed', 'resolve:payouts:waiting', 'resolve:sweeps:failed', 'resolve:treasury:shortfall']);
    expect(a.status().active).toHaveLength(0);
  });
  it('warns before the rate expires and does nothing when rand pricing is unused', async () => {
    const wh = recorder('webhook', (s) => s !== 'info');
    const a = new Alerter([wh], { console: quiet });
    await runWatchdogOnce(db({ fxAgeH: 20 }), a, { fxMaxAgeHours: 24 });
    expect(a.status().active[0]).toMatchObject({ key: 'fx:stale', severity: 'warning' });
    const b = new Alerter([wh], { console: quiet });
    await runWatchdogOnce(db({ fxAgeH: null }), b);
    expect(b.status().active).toHaveLength(0);
  });
});

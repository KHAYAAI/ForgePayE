/**
 * Alert routing. The gateway already notices the things that need a person — a treasury shortfall,
 * a failed sweep, a payout that did not go out — but noticing in a log nobody reads is not
 * alerting. This sends them where someone will see them, and says so when delivery itself fails.
 *
 *   critical  -> PagerDuty (if configured) + webhook + console
 *   warning   -> webhook + console
 *   info      -> console
 *
 * A condition is identified by a key. Raising a key that is already active does not page again until
 * the reminder interval passes; resolving it sends one "resolved". If every destination for an alert
 * fails, it is NOT treated as sent, so it is retried on the next raise rather than silently lost.
 *
 *   ALERT_WEBHOOK_URL            Slack-style incoming webhook, or any endpoint taking JSON
 *   ALERT_WEBHOOK_FORMAT         slack (default) | json
 *   ALERT_PAGERDUTY_ROUTING_KEY  PagerDuty Events API v2 integration key
 *   ALERT_REMINDER_MINUTES       default 60
 *   ALERT_ENV                    label shown on every alert (e.g. production)
 */

export type Severity = 'critical' | 'warning' | 'info';
export interface Alert { key: string; severity: Severity; title: string; detail: string; at: string; env: string }
export type AlertEvent = 'trigger' | 'resolve';

export interface AlertSink {
  name: string;
  accepts(severity: Severity): boolean;
  send(a: Alert, event: AlertEvent): Promise<void>;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const withTimeout = async (fetchImpl: Fetch, url: string, init: Parameters<Fetch>[1]) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetchImpl(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } finally { clearTimeout(t); }
};

export class WebhookSink implements AlertSink {
  name = 'webhook';
  constructor(private url: string, private format: 'slack' | 'json' = 'slack', private fetchImpl: Fetch = fetch as unknown as Fetch) {}
  accepts(s: Severity) { return s !== 'info'; }
  async send(a: Alert, event: AlertEvent) {
    const icon = event === 'resolve' ? '✅ RESOLVED' : a.severity === 'critical' ? '🚨 CRITICAL' : '⚠️ WARNING';
    const body = this.format === 'slack'
      ? { text: `${icon} [${a.env}] ${a.title}\n${a.detail}` }
      : { event, ...a };
    await withTimeout(this.fetchImpl, this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
}

export class PagerDutySink implements AlertSink {
  name = 'pagerduty';
  constructor(private routingKey: string, private fetchImpl: Fetch = fetch as unknown as Fetch) {}
  accepts(s: Severity) { return s === 'critical'; }
  async send(a: Alert, event: AlertEvent) {
    const body = event === 'resolve'
      ? { routing_key: this.routingKey, event_action: 'resolve', dedup_key: a.key }
      : { routing_key: this.routingKey, event_action: 'trigger', dedup_key: a.key,
          payload: { summary: `[${a.env}] ${a.title}`.slice(0, 1000), source: 'forge-stablecoin-gateway', severity: 'critical', custom_details: { detail: a.detail } } };
    await withTimeout(this.fetchImpl, 'https://events.pagerduty.com/v2/enqueue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
}

export class Alerter {
  private active = new Map<string, { alert: Alert; lastSent: number | null }>();
  private history: Array<Alert & { event: AlertEvent; delivered: string[]; failed: string[] }> = [];
  private deliveryFailures = 0;

  constructor(
    private sinks: AlertSink[],
    private opts: { env?: string; reminderMs?: number; now?: () => number; console?: (line: string) => void } = {},
  ) {}

  private now() { return (this.opts.now ?? Date.now)(); }
  private log(line: string) { (this.opts.console ?? ((l) => console.error(l)))(line); }

  /** A condition that needs attention is true now. Safe to call every pass. */
  async raise(key: string, severity: Severity, title: string, detail: string): Promise<void> {
    const reminder = this.opts.reminderMs ?? 60 * 60_000;
    const cur = this.active.get(key);
    const alert: Alert = { key, severity, title, detail, at: new Date(this.now()).toISOString(), env: this.opts.env ?? 'unspecified' };
    const escalated = cur && cur.alert.severity !== 'critical' && severity === 'critical';
    if (cur && cur.lastSent !== null && this.now() - cur.lastSent < reminder && !escalated) {
      this.active.set(key, { alert: { ...alert, at: cur.alert.at }, lastSent: cur.lastSent });
      return;
    }
    const ok = await this.deliver(alert, 'trigger');
    this.active.set(key, { alert: cur ? { ...alert, at: cur.alert.at } : alert, lastSent: ok ? this.now() : null });
  }

  /** The condition is no longer true. Sends one resolution if it had been raised. */
  async resolve(key: string, note = 'cleared'): Promise<void> {
    const cur = this.active.get(key);
    if (!cur) return;
    this.active.delete(key);
    if (cur.lastSent === null) return; // never delivered, so there is nothing to resolve
    await this.deliver({ ...cur.alert, detail: note, at: new Date(this.now()).toISOString() }, 'resolve');
  }

  private async deliver(a: Alert, event: AlertEvent): Promise<boolean> {
    this.log(`[alert] ${event === 'resolve' ? 'RESOLVED' : a.severity.toUpperCase()} ${a.key}: ${a.title} — ${a.detail}`);
    const wanted = this.sinks.filter((s) => s.accepts(a.severity));
    const delivered: string[] = [], failed: string[] = [];
    await Promise.all(wanted.map(async (s) => {
      try { await s.send(a, event); delivered.push(s.name); }
      catch (e) { failed.push(s.name); this.deliveryFailures++; this.log(`[alert] could not deliver "${a.key}" to ${s.name}: ${e instanceof Error ? e.message : e}`); }
    }));
    this.history.push({ ...a, event, delivered, failed });
    if (this.history.length > 200) this.history.shift();
    // Console-only alerts (info, or no destinations configured) count as delivered; otherwise at least one must have worked.
    return wanted.length === 0 || delivered.length > 0;
  }

  status() {
    return {
      destinations: this.sinks.map((s) => s.name),
      active: [...this.active.values()].map((v) => ({ key: v.alert.key, severity: v.alert.severity, title: v.alert.title, since: v.alert.at, delivered: v.lastSent !== null })),
      deliveryFailures: this.deliveryFailures,
      recent: this.history.slice(-20).reverse(),
    };
  }
}

export function alerterFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: Fetch): Alerter {
  const sinks: AlertSink[] = [];
  if (env['ALERT_WEBHOOK_URL']) sinks.push(new WebhookSink(env['ALERT_WEBHOOK_URL'], env['ALERT_WEBHOOK_FORMAT'] === 'json' ? 'json' : 'slack', fetchImpl));
  if (env['ALERT_PAGERDUTY_ROUTING_KEY']) sinks.push(new PagerDutySink(env['ALERT_PAGERDUTY_ROUTING_KEY'], fetchImpl));
  return new Alerter(sinks, { env: env['ALERT_ENV'] ?? env['NODE_ENV'] ?? 'unspecified', reminderMs: Number(env['ALERT_REMINDER_MINUTES'] ?? '60') * 60_000 });
}

let shared: Alerter | null = null;
export function alerts(): Alerter { return (shared ??= alerterFromEnv()); }
export function setAlerter(a: Alerter | null): void { shared = a; }

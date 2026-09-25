/**
 * Server-side clients for the FORGE service mesh.
 *
 * The console never calls services from the browser — Next.js API routes
 * proxy every read so service URLs and internal secrets stay server-side
 * and CORS never enters the picture.
 *
 * Every helper returns { live, data }: `live:false` means the service was
 * unreachable/errored and the page should fall back to demo fixtures.
 */

const TIMEOUT_MS = 4000;

export interface LiveResult<T> {
  live: boolean;
  data: T | null;
  error?: string;
}

export const SERVICE_URLS = {
  custody: process.env.FORGE_CUSTODY_URL ?? 'http://localhost:3019',
  wallet: process.env.FORGE_WALLET_URL ?? 'http://localhost:3020',
  treasury: process.env.ENTERPRISE_TREASURY_URL ?? 'http://localhost:3012',
  bureau: process.env.AGENT_CREDIT_BUREAU_URL ?? 'http://localhost:3018',
  router: process.env.UNIFIED_ROUTER_URL ?? 'http://localhost:8000',
} as const;

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<LiveResult<T>> {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return { live: false, data: null, error: `HTTP ${res.status}` };
    return { live: true, data: (await res.json()) as T };
  } catch (err) {
    return { live: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function consoleSecretHeaders(): Record<string, string> {
  const secret = process.env.CONSOLE_SECRET;
  return secret ? { 'x-console-secret': secret } : {};
}

// The bureau denies by default — every route but /health, /metrics and
// GET /v1/plans requires a scoped key. The console reads and resolves
// disputes across every agent, which only the admin key can do; it never
// forwards a caller's own credential. BUREAU_ADMIN_API_KEY must match
// whatever the bureau service itself was booted with (see
// services/agent-credit-bureau/src/auth.ts) — the same dev fallback so
// local dev works without configuring both sides separately.
function bureauAuthHeaders(): Record<string, string> {
  const key = process.env.BUREAU_ADMIN_API_KEY ?? 'dev-bureau-admin-key';
  return { authorization: `Bearer ${key}` };
}

export function getCustodySummary<T>(): Promise<LiveResult<T>> {
  return fetchJson<T>(`${SERVICE_URLS.custody}/api/v1/console/summary`, consoleSecretHeaders());
}

export function getWalletSummary<T>(): Promise<LiveResult<T>> {
  return fetchJson<T>(`${SERVICE_URLS.wallet}/api/v1/console/summary`, consoleSecretHeaders());
}

export async function getTreasurySummary<T = Record<string, unknown>>(): Promise<LiveResult<T>> {
  // Compose the treasury view from its public read endpoints.
  const [position, rules, approvals, flows] = await Promise.all([
    fetchJson<Record<string, unknown>>(`${SERVICE_URLS.treasury}/v1/cash-position`),
    fetchJson<Record<string, unknown>>(`${SERVICE_URLS.treasury}/v1/rules`),
    fetchJson<Record<string, unknown>>(`${SERVICE_URLS.treasury}/v1/rules/approvals`),
    fetchJson<Record<string, unknown>>(`${SERVICE_URLS.treasury}/v1/netting/flows`),
  ]);
  if (!position.live) return { live: false, data: null, error: position.error };
  return {
    live: true,
    data: {
      cash_position: position.data,
      rules: rules.data,
      approvals: approvals.data,
      netting_flows: flows.data,
    } as T,
  };
}

export async function getBureauStats<T = Record<string, unknown>>(): Promise<LiveResult<T>> {
  // Bureau endpoints wrap payloads in {data}. Compose stats + agent register.
  const [stats, agents] = await Promise.all([
    fetchJson<{ data: Record<string, unknown> }>(`${SERVICE_URLS.bureau}/v1/bureau/stats`, bureauAuthHeaders()),
    fetchJson<{ data: unknown[] }>(`${SERVICE_URLS.bureau}/v1/agents?limit=20`, bureauAuthHeaders()),
  ]);
  if (!stats.live) return { live: false, data: null, error: stats.error };
  return {
    live: true,
    data: { stats: stats.data?.data ?? {}, agents: agents.data?.data ?? [] } as T,
  };
}

interface BureauAgentRow {
  agentId: string;
  did: string;
  operatorEntityId: string;
  currentScore: number;
}

async function listBureauAgents(limit = 50): Promise<BureauAgentRow[]> {
  const agents = await fetchJson<{ data: BureauAgentRow[] }>(
    `${SERVICE_URLS.bureau}/v1/agents?limit=${limit}`, bureauAuthHeaders(),
  );
  return agents.live ? (agents.data?.data ?? []) : [];
}

interface RawCreditEvent {
  eventType: string;
  description: string;
  timestamp: string;
  amount?: number;
}

/** Score factors + credit history for one agent's file — Agents page drill-in. */
export async function getBureauAgentDetail<T = Record<string, unknown>>(agentId: string): Promise<LiveResult<T>> {
  const [score, history] = await Promise.all([
    fetchJson<{ data: Record<string, unknown> }>(`${SERVICE_URLS.bureau}/v1/agents/${encodeURIComponent(agentId)}/score`, bureauAuthHeaders()),
    fetchJson<{ data: RawCreditEvent[] }>(`${SERVICE_URLS.bureau}/v1/agents/${encodeURIComponent(agentId)}/history?limit=20`, bureauAuthHeaders()),
  ]);
  if (!score.live) return { live: false, data: null, error: score.error };

  const events = (history.data?.data ?? []).map((e) => ({
    at: new Date(e.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    type: e.eventType,
    detail: e.description,
    amount: e.amount != null ? `R${Math.round(e.amount).toLocaleString('en-US')}` : undefined,
  }));

  return {
    live: true,
    data: { factors: score.data?.data?.['factors'] ?? [], events } as T,
  };
}

interface RawDualScore {
  mode1: { score: number; recommendation: string };
  mode2: { score: number; txHash?: string; blockNumber?: number; chainId?: number; settledAt?: string } | null;
  consensus: { level: 'HIGH' | 'MEDIUM' | 'LOW' };
}

/** Dual-mode (Mode 1 / Mode 2) score for every registered agent — Scores page register. */
export async function getBureauDualScores<T = Record<string, unknown>>(): Promise<LiveResult<T>> {
  const agents = await listBureauAgents();
  if (agents.length === 0) return { live: false, data: null, error: 'bureau unreachable or no agents' };

  const scores = await Promise.all(
    agents.map((a) =>
      fetchJson<{ data: RawDualScore }>(
        `${SERVICE_URLS.bureau}/v1/agents/${encodeURIComponent(a.agentId)}/dual-score`, bureauAuthHeaders(),
      ).then((r) => ({ agent: a, result: r })),
    ),
  );

  const live = scores.filter(({ result }) => result.live) as Array<{ agent: BureauAgentRow; result: { data: { data: RawDualScore } } }>;
  if (live.length === 0) return { live: false, data: null, error: 'no dual-scores available' };

  const dualRows = live.map(({ agent, result }) => {
    const d = result.data.data;
    return {
      did: agent.did,
      operator: agent.operatorEntityId,
      mode1: d.mode1.score,
      mode2: d.mode2?.score ?? d.mode1.score,
      consensus: d.consensus.level,
      decision: d.mode1.recommendation,
      settled: !!d.mode2?.txHash,
    };
  });

  const settlements = live
    .filter(({ result }) => result.data.data.mode2?.txHash)
    .map(({ agent, result }) => {
      const m2 = result.data.data.mode2!;
      return {
        did: agent.did,
        txHash: m2.txHash!,
        block: m2.blockNumber ?? 0,
        chain: m2.chainId === 8453 ? 'base' : String(m2.chainId ?? 'unknown'),
        settledAt: m2.settledAt ? new Date(m2.settledAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—',
      };
    });

  return { live: true, data: { dualRows, settlements } as T };
}

interface RawDispute {
  id: string;
  agentId: string;
  eventId: string;
  status: 'open' | 'investigating' | 'resolved_upheld' | 'resolved_corrected' | 'resolved_deleted';
  filedAt: string;
  resolvedAt?: string;
  escalatedAt?: string;
  description: string;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const DISPUTE_CLOCK_DAYS = 30;

function disputeClock(filedAt: string, status: RawDispute['status']): string {
  if (status !== 'open' && status !== 'investigating') return '—';
  const daysSince = (Date.now() - new Date(filedAt).getTime()) / (1000 * 60 * 60 * 24);
  const left = Math.max(0, Math.ceil(DISPUTE_CLOCK_DAYS - daysSince));
  return `${left} day${left === 1 ? '' : 's'} left`;
}

/** The FCRA-style dispute queue, joined with each disputed agent's DID. */
export async function getBureauDisputes<T = Record<string, unknown>>(): Promise<LiveResult<T>> {
  const [disputes, agents] = await Promise.all([
    fetchJson<{ data: RawDispute[] }>(`${SERVICE_URLS.bureau}/v1/disputes?limit=100`, bureauAuthHeaders()),
    listBureauAgents(),
  ]);
  if (!disputes.live) return { live: false, data: null, error: disputes.error };

  const didFor = new Map(agents.map((a) => [a.agentId, a.did]));
  // The disputed event's type isn't in the dispute record itself (only its
  // id); rather than an extra history fetch per dispute to resolve it, the
  // event id is shown as-is — it's real and traceable, just less readable
  // than a type string.
  const raw = disputes.data?.data ?? [];
  const rows = raw.map((d) => ({
    id: d.id,
    did: didFor.get(d.agentId) ?? d.agentId,
    event: d.eventId,
    description: d.description,
    filed: new Date(d.filedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    clock: disputeClock(d.filedAt, d.status),
    status: d.status,
  }));

  const now = Date.now();
  const resolvedRecently = raw.filter((d) => d.resolvedAt && now - new Date(d.resolvedAt).getTime() <= NINETY_DAYS_MS);
  const correctedOrDeleted = resolvedRecently.filter((d) => d.status === 'resolved_corrected' || d.status === 'resolved_deleted');
  const resolutionDays = resolvedRecently
    .map((d) => (new Date(d.resolvedAt!).getTime() - new Date(d.filedAt).getTime()) / (1000 * 60 * 60 * 24))
    .sort((a, b) => a - b);
  const medianResolutionDays = resolutionDays.length
    ? resolutionDays[Math.floor(resolutionDays.length / 2)]!
    : null;
  const escalations = raw.filter((d) => d.escalatedAt).length;

  return {
    live: true,
    data: {
      rows,
      resolved90d: resolvedRecently.length,
      correctedOrDeleted90d: correctedOrDeleted.length,
      medianResolutionDays,
      escalations,
    } as T,
  };
}

/** Run the 8-check verification for one agent. A write, so not cached/polled. */
export async function postBureauVerify<T = Record<string, unknown>>(agentId: string): Promise<LiveResult<T>> {
  try {
    const res = await fetch(`${SERVICE_URLS.bureau}/v1/agents/${encodeURIComponent(agentId)}/verify`, {
      method: 'POST',
      headers: bureauAuthHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return { live: false, data: null, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { data: T };
    return { live: true, data: json.data };
  } catch (err) {
    return { live: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Advance or resolve a dispute. A write, so not cached/polled. */
export async function putBureauDispute<T = Record<string, unknown>>(
  disputeId: string,
  body: { status: string; resolution?: string; correction?: unknown },
): Promise<LiveResult<T>> {
  try {
    const res = await fetch(`${SERVICE_URLS.bureau}/v1/disputes/${encodeURIComponent(disputeId)}`, {
      method: 'PUT',
      headers: { ...bureauAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return { live: false, data: null, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { data: T };
    return { live: true, data: json.data };
  } catch (err) {
    return { live: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export function getOntologyEvents<T>(limit = 25): Promise<LiveResult<T>> {
  // The events feed is merchant-scoped and Bearer-authenticated; the console
  // reads it with the internal secret when configured. Without it this
  // resolves live:false and the overview falls back to demo events.
  const token = process.env.INTERNAL_WEBHOOK_SECRET;
  const merchantId = process.env.CONSOLE_MERCHANT_ID ?? 'all';
  if (!token) return Promise.resolve({ live: false, data: null, error: 'no internal token' });
  return fetchJson<T>(
    `${SERVICE_URLS.router}/events/?merchant_id=${encodeURIComponent(merchantId)}&limit=${limit}`,
    { authorization: `Bearer ${token}` },
  );
}

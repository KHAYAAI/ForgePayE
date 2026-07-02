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
    fetchJson<{ data: Record<string, unknown> }>(`${SERVICE_URLS.bureau}/v1/bureau/stats`),
    fetchJson<{ data: unknown[] }>(`${SERVICE_URLS.bureau}/v1/agents?limit=20`),
  ]);
  if (!stats.live) return { live: false, data: null, error: stats.error };
  return {
    live: true,
    data: { stats: stats.data?.data ?? {}, agents: agents.data?.data ?? [] } as T,
  };
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

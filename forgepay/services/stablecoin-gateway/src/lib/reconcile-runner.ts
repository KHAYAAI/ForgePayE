import { ethers } from 'ethers';
import { reconcile, rpcReconChain, type ReconChain, type ReconReport } from './reconcile.js';
import { alerts } from './alerts.js';

let last: ReconReport | null = null;
export const lastReport = () => last;

const chains = new Map<string, ReconChain>();

/** Run one reconciliation against the real database, registry and RPC endpoints. */
export async function reconcileNow(): Promise<ReconReport> {
  const [{ getDb }, { config }, { gatewayContext }] = await Promise.all([import('./db.js'), import('../config.js'), import('./context.js')]);
  const ctx = await gatewayContext();
  const rpc = config.rpc as Record<string, string>;
  const report = await reconcile({
    db: getDb() as never,
    chain: (c) => {
      const url = rpc[c];
      if (!url) return null;
      let api = chains.get(c);
      if (!api) { api = rpcReconChain(new ethers.JsonRpcProvider(url, undefined, { staticNetwork: false })); chains.set(c, api); }
      return api;
    },
    tokenAddress: (symbol, chain) => ctx.registry.get(symbol, chain)?.address,
  }, { windowHours: Number(process.env['RECONCILE_WINDOW_HOURS'] ?? '72') });
  last = report;
  const a = alerts();
  const critical = report.findings.filter((f) => f.severity === 'critical');
  if (critical.length) {
    await a.raise('recon:mismatch', 'critical', `Reconciliation: ${critical.length} record(s) do not match the chain`,
      critical.slice(0, 10).map((f) => `${f.code} ${f.ref}: ${f.detail}`).join('\n'));
  } else await a.resolve('recon:mismatch', 'the ledger matches the chain for the rows examined');
  if (report.errors.length) await a.raise('recon:errors', 'warning', 'Reconciliation could not check everything', report.errors.slice(0, 10).join('\n'));
  else await a.resolve('recon:errors');
  return report;
}

/** Run daily (RECONCILE_INTERVAL_HOURS, default 24), on the leader only; first run a minute after start. */
export function startReconcile(shouldRun?: () => boolean): { stop: () => void } {
  const every = Math.max(1, Number(process.env['RECONCILE_INTERVAL_HOURS'] ?? '24')) * 3_600_000;
  let running = false;
  const tick = async () => {
    if (running || shouldRun?.() === false) return;
    running = true;
    try { await reconcileNow(); } catch (e) { console.error('[reconcile] failed:', e instanceof Error ? e.message : e); } finally { running = false; }
  };
  const first = setTimeout(() => { void tick(); }, 60_000);
  const t = setInterval(() => { void tick(); }, every);
  first.unref?.(); t.unref?.();
  return { stop: () => { clearTimeout(first); clearInterval(t); } };
}

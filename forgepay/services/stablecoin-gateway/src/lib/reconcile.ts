/**
 * Daily reconciliation: does the chain agree with the ledger?
 *
 * The gateway's own records say what should have happened. This checks them against what the chain says
 * happened, and reports every difference, never repairing anything:
 *
 *   deposit_short      a confirmed, unswept deposit whose address holds LESS than was credited
 *   sweep_unverified   a sweep marked swept with no successful transfer of its units to the treasury
 *   payout_unverified  a payout marked confirmed with no successful transfer of its units to the payee
 *   stuck_*            payouts/sweeps/deposits that have sat in flight too long
 *
 * A clean run proves the records match the chain for the rows examined (a recent window), not that the
 * wallets' total balances equal the ledger: float and treasury balances are reported for a person to compare.
 */
import { ethers } from 'ethers';
import type { Queryable } from './watchdog.js';

export interface ReconChain {
  receipt(hash: string): Promise<{ status: number | null; logs: Array<{ address: string; topics: readonly string[]; data: string }> } | null>;
  balanceOf(token: string, owner: string): Promise<bigint>;
}

export type Severity = 'critical' | 'warning';
export interface Finding { code: string; severity: Severity; ref: string; detail: string }
export interface ReconReport {
  at: string; windowHours: number;
  examined: { deposits: number; sweeps: number; payouts: number };
  findings: Finding[];
  clean: boolean;
  errors: string[];
}

export interface ReconDeps {
  db: Queryable;
  chain: (chain: string) => ReconChain | null;
  tokenAddress: (symbol: string, chain: string) => string | undefined;
  now?: () => number;
}

const TRANSFER = ethers.id('Transfer(address,address,uint256)');
const addr = (topic: string) => ('0x' + topic.slice(26)).toLowerCase();

/** Did this receipt move at least `units` of `token` to `to`? */
export function transferred(r: NonNullable<Awaited<ReturnType<ReconChain['receipt']>>>, token: string, to: string, units: bigint): boolean {
  if (r.status !== 1) return false;
  return r.logs.some((l) =>
    l.address.toLowerCase() === token.toLowerCase() && l.topics[0] === TRANSFER && l.topics[2] !== undefined &&
    addr(l.topics[2]!) === to.toLowerCase() && BigInt(l.data) >= units);
}

export async function reconcile(deps: ReconDeps, opts: { windowHours?: number; stuckMinutes?: number } = {}): Promise<ReconReport> {
  const now = deps.now?.() ?? Date.now();
  const windowHours = opts.windowHours ?? 72;
  const stuckMs = (opts.stuckMinutes ?? 60) * 60_000;
  const since = new Date(now - windowHours * 3_600_000).toISOString();
  const report: ReconReport = { at: new Date(now).toISOString(), windowHours, examined: { deposits: 0, sweeps: 0, payouts: 0 }, findings: [], clean: true, errors: [] };
  const add = (f: Finding) => report.findings.push(f);
  const guard = async (name: string, f: () => Promise<void>) => { try { await f(); } catch (e) { report.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } };

  await guard('deposits', async () => {
    const rows = (await deps.db.query(
      `SELECT id, chain, token, address, received_amount_units FROM stablecoin_deposits
        WHERE status = 'confirmed' AND swept_at IS NULL AND received_amount_units IS NOT NULL AND confirmed_at > $1`, [since])).rows;
    for (const d of rows) {
      report.examined.deposits++;
      const chain = deps.chain(d.chain), token = deps.tokenAddress(d.token, d.chain);
      if (!chain || !token) { report.errors.push(`deposit ${d.id}: cannot read ${d.token} on ${d.chain}`); continue; }
      const held = await chain.balanceOf(token, d.address);
      if (held < BigInt(d.received_amount_units)) {
        add({ code: 'deposit_short', severity: 'critical', ref: d.id, detail: `credited ${d.received_amount_units} units but ${d.address} holds ${held}` });
      }
    }
  });

  await guard('sweeps', async () => {
    const rows = (await deps.db.query(
      `SELECT id, chain, asset, units, sweep_tx, treasury_address, kind FROM deposit_sweeps WHERE status = 'swept' AND updated_at > $1`, [since])).rows;
    for (const s of rows) {
      report.examined.sweeps++;
      const chain = deps.chain(s.chain);
      const token = /^0x/i.test(s.asset) ? s.asset : deps.tokenAddress(s.asset, s.chain);
      if (!chain || !token || !s.sweep_tx || !s.units) {
        add({ code: 'sweep_unverified', severity: 'critical', ref: s.id, detail: 'marked swept but has no transaction hash or units recorded' });
        continue;
      }
      const r = await chain.receipt(s.sweep_tx);
      if (!r || !transferred(r, token, s.treasury_address, BigInt(s.units))) {
        add({ code: 'sweep_unverified', severity: 'critical', ref: s.id, detail: `transaction ${s.sweep_tx} does not show ${s.units} units reaching ${s.treasury_address}` });
      }
    }
  });

  await guard('payouts', async () => {
    const rows = (await deps.db.query(
      `SELECT id, chain, asset, amount_units, tx_hash, payee_address FROM payouts WHERE status = 'confirmed' AND updated_at > $1`, [since])).rows;
    for (const p of rows) {
      report.examined.payouts++;
      const chain = deps.chain(p.chain), token = deps.tokenAddress(p.asset ?? 'USDC', p.chain);
      if (!chain || !token || !p.tx_hash) {
        add({ code: 'payout_unverified', severity: 'critical', ref: p.id, detail: 'marked confirmed but has no transaction hash' });
        continue;
      }
      const r = await chain.receipt(p.tx_hash);
      if (!r || !transferred(r, token, p.payee_address, BigInt(p.amount_units))) {
        add({ code: 'payout_unverified', severity: 'critical', ref: p.id, detail: `transaction ${p.tx_hash} does not show ${p.amount_units} units reaching ${p.payee_address}` });
      }
    }
  });

  await guard('stuck', async () => {
    const cutoff = new Date(now - stuckMs).toISOString();
    for (const [code, sql] of [
      ['stuck_payout', `SELECT id FROM payouts WHERE status IN ('submitted') AND updated_at < $1`],
      ['stuck_sweep', `SELECT id FROM deposit_sweeps WHERE status IN ('planned','gas_sent','sending') AND updated_at < $1`],
      ['stuck_deposit', `SELECT id FROM stablecoin_deposits WHERE status = 'confirming' AND received_at < $1`],
    ] as const) {
      for (const r of (await deps.db.query(sql, [cutoff])).rows) add({ code, severity: 'warning', ref: r.id, detail: `in flight for over ${Math.round(stuckMs / 60000)} minutes` });
    }
  });

  report.clean = report.findings.length === 0 && report.errors.length === 0;
  return report;
}

/** Adapter over an ethers provider. */
export function rpcReconChain(provider: ethers.JsonRpcProvider): ReconChain {
  return {
    async receipt(hash) {
      const r = await provider.getTransactionReceipt(hash);
      return r ? { status: r.status, logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })) } : null;
    },
    async balanceOf(token, owner) {
      return BigInt(await new ethers.Contract(token, ['function balanceOf(address) view returns (uint256)'], provider)['balanceOf']!(owner));
    },
  };
}

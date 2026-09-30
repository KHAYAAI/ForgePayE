/**
 * Operator routes for sweeping deposit addresses into the treasury. All admin-only.
 *
 *   GET  /sweeps/config      whether sweeping is on, the treasury, the gas wallet and its balance
 *   GET  /sweeps             sweep attempts (?status=)
 *   POST /sweeps/run         run a pass now
 *   POST /sweeps             sweep one specific deposit the automatic pass wouldn't (expired, short): needs a reason
 *   POST /sweeps/:id/retry   put a failed sweep back, after someone has looked at why
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { ethers } from 'ethers';
import { getDb } from '../lib/db.js';
import { resolveSweepConfig, sweepRequested, createSweeper, type Sweeper } from '../lib/sweeper.js';

let sweeperPromise: Promise<Sweeper> | null = null;
export function setSweeper(s: Sweeper | null): void { sweeperPromise = s ? Promise.resolve(s) : null; }
async function sweeper(): Promise<Sweeper | null> {
  if (!sweepRequested()) return null;
  sweeperPromise ??= createSweeper(resolveSweepConfig());
  return sweeperPromise;
}

const deny = (reply: FastifyReply) => reply.code(403).send({ error: 'Forbidden', message: 'sweeping is an operator action' });

export async function buildSweepRoutes(app: FastifyInstance) {
  app.get('/config', async (req, reply) => {
    if (req.auth?.kind !== 'admin') return deny(reply);
    const s = await sweeper();
    if (!s) return reply.send({ enabled: false, note: 'Sweeping is off (SWEEP_ENABLED is not "true"). Paid-in funds stay in the one-time deposit addresses.' });
    const cfg = resolveSweepConfig();
    const chains = ['ethereum', 'polygon', 'base', 'arbitrum'];
    const out: Record<string, unknown> = {};
    for (const c of chains) {
      const t = cfg.treasury(c);
      if (!t) continue;
      let gas: { address: string; balance_wei: string | null } = { address: s.gasWalletFor(c).address, balance_wei: null };
      try { gas.balance_wei = (await s.gasWalletFor(c).provider!.getBalance(gas.address)).toString(); } catch { /* chain unreachable */ }
      out[c] = { treasury: t, gas_wallet: gas.address, gas_wallet_balance_wei: gas.balance_wei };
    }
    reply.send({ enabled: true, min_usd: cfg.minUsd, max_gas_gwei: cfg.maxGasGwei, gas_margin_pct: cfg.gasMarginPct, chains: out });
  });

  app.get<{ Querystring: { status?: string } }>('/', async (req, reply) => {
    if (req.auth?.kind !== 'admin') return deny(reply);
    const r = await getDb().query(
      `SELECT id, deposit_id, chain, asset, from_address, treasury_address, status, units, gas_wei, gas_tx, sweep_tx, reason, error, created_at, updated_at
         FROM deposit_sweeps ${req.query.status ? 'WHERE status = $1' : ''} ORDER BY created_at DESC LIMIT 500`,
      req.query.status ? [req.query.status] : []);
    reply.send({ data: r.rows, count: r.rows.length });
  });

  app.post<{ Body: { chain?: string } }>('/run', async (req, reply) => {
    if (req.auth?.kind !== 'admin') return deny(reply);
    const s = await sweeper();
    if (!s) return reply.code(409).send({ error: 'SweepingOff', message: 'SWEEP_ENABLED is not "true".' });
    const chain = req.body?.chain ?? 'base';
    reply.send({ chain, report: await s.runOnce(chain) });
  });

  app.post<{ Body: { deposit_id?: string; reason?: string } }>('/', async (req, reply) => {
    if (req.auth?.kind !== 'admin') return deny(reply);
    const s = await sweeper();
    if (!s) return reply.code(409).send({ error: 'SweepingOff', message: 'SWEEP_ENABLED is not "true".' });
    const { deposit_id, reason } = req.body ?? {};
    if (!deposit_id || !reason || reason.length < 5) {
      return reply.code(400).send({ error: 'ValidationError', message: 'deposit_id and a reason (at least 5 characters) are required: this moves funds that were not credited' });
    }
    try { reply.code(201).send({ data: await s.planManual(deposit_id, reason) }); }
    catch (e) { reply.code(409).send({ error: 'NotSweepable', message: (e as Error).message }); }
  });

  app.post<{ Params: { id: string } }>('/:id/retry', async (req, reply) => {
    if (req.auth?.kind !== 'admin') return deny(reply);
    const s = await sweeper();
    if (!s) return reply.code(409).send({ error: 'SweepingOff' });
    const row = await s.retry(req.params.id);
    if (!row) return reply.code(404).send({ error: 'NotFound', message: 'no failed sweep with that id' });
    reply.send({ data: row });
  });
}

void ethers;

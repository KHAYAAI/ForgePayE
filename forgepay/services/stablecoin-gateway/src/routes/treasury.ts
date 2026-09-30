/**
 * Operator view of the treasury tiers (see lib/treasury.ts). Admin only.
 *
 *   GET  /treasury/status     balances of the payout and operating wallets, the daily cap, and any shortfall
 *   GET  /treasury/transfers  the gateway's own wallet-to-wallet movements
 *   POST /treasury/run        run a pass now
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { getDb } from '../lib/db.js';
import { treasuryRequested, resolveTreasuryConfig, createTreasuryManager, type TreasuryManager } from '../lib/treasury.js';

let managerPromise: Promise<TreasuryManager | null> | null = null;
export function setTreasuryManager(m: TreasuryManager | null): void { managerPromise = Promise.resolve(m); }

async function manager(): Promise<TreasuryManager | null> {
  if (managerPromise) return managerPromise;
  if (!treasuryRequested()) return null;
  managerPromise = (async () => {
    const { currentBroadcaster } = await import('../lib/payouts.js');
    const address = (currentBroadcaster() as unknown as { address?: string }).address;
    return createTreasuryManager(resolveTreasuryConfig(process.env, address), address!);
  })();
  return managerPromise;
}

const deny = (reply: FastifyReply) => reply.code(403).send({ error: 'Forbidden', message: 'treasury operations are an operator action' });

export async function buildTreasuryRoutes(app: FastifyInstance) {
  app.get('/status', async (req, reply) => {
    if (req.auth?.kind !== 'admin') return deny(reply);
    const m = await manager();
    if (!m) return reply.send({ enabled: false, note: 'The treasury manager is off (TREASURY_MANAGER_ENABLED is not "true"): the payout wallet is topped up by hand.' });
    reply.send({ enabled: true, ...(await m.status()) });
  });

  app.get('/transfers', async (req, reply) => {
    if (req.auth?.kind !== 'admin') return deny(reply);
    const r = await getDb().query(`SELECT id, kind, chain, asset, from_address, to_address, units, usd_micro, status, tx, error, created_at FROM treasury_transfers ORDER BY created_at DESC LIMIT 200`);
    reply.send({ data: r.rows, count: r.rows.length });
  });

  app.post('/run', async (req, reply) => {
    if (req.auth?.kind !== 'admin') return deny(reply);
    const m = await manager();
    if (!m) return reply.code(409).send({ error: 'TreasuryOff', message: 'TREASURY_MANAGER_ENABLED is not "true".' });
    reply.send(await m.runOnce());
  });
}

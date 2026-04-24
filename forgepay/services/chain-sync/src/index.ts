/**
 * ARCH: ForgePay Chain Sync Service
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Keeps on-chain ZK contract state synchronized with ForgePay's PostgreSQL.
 *
 * Monitors across Ethereum, Polygon, Base, Arbitrum:
 *   - CommitmentTree.RootUpdated → update merkle_tree_state table
 *   - NullifierRegistry.PaymentConfirmed → confirm shielded checkout sessions
 *   - NullifierRegistry.NullifierFrozen → block pending sessions with frozen nullifiers
 *
 * Chain sync flow:
 *   CommitmentTree emits RootUpdated(version, newRoot)
 *     → chain-sync writes to chain_events
 *     → chain-sync forwards to unified-router
 *     → unified-router fans out to merchant webhooks (if configured)
 *
 *   NullifierRegistry emits PaymentConfirmed(nullifier, merkleRoot, amount)
 *     → chain-sync marks checkout_session.status = 'completed'
 *     → chain-sync forwards to unified-router
 *     → unified-router emits 'shielded.payment.confirmed' merchant event
 *
 * Port: 8040
 *
 * STUB: Contract addresses are all-zero until deployed.
 * Monitors will log warnings and skip if RPC or address is not configured.
 */

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { Pool } from 'pg';
import { config } from './config.js';
import { startMerkleSync } from './lib/merkle-sync.js';
import { startNullifierSync } from './lib/nullifier-sync.js';

const CHAINS = ['ethereum', 'polygon', 'base', 'arbitrum'] as const;

async function main() {
  const app = Fastify({ logger: true, trustProxy: true });
  await app.register(helmet, { contentSecurityPolicy: false });

  const db = new Pool({ connectionString: config.databaseUrl });

  // Health / readiness
  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'chain-sync',
    chains: Object.keys(config.chains),
  }));

  app.get('/readyz', async (req, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ready' };
    } catch (err) {
      return reply.status(503).send({ status: 'not_ready', error: String(err) });
    }
  });

  // Status endpoint: current Merkle roots and sync state per chain
  app.get('/status', async () => {
    const result = await db.query(
      `SELECT chain, version, current_root, updated_at
         FROM merkle_tree_state
        ORDER BY chain`
    );
    return {
      service: 'chain-sync',
      merkle_state: result.rows,
      chains: Object.entries(config.chains).map(([name, cfg]) => ({
        name,
        rpc_configured: !!cfg.rpcUrl,
        contracts: {
          groth16_verifier:   cfg.groth16VerifierAddr,
          nullifier_registry: cfg.nullifierRegistryAddr,
          commitment_tree:    cfg.commitmentTreeAddr,
        },
      })),
    };
  });

  const shutdown = async () => {
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[chain-sync] Listening on :${config.port}`);

  // Start chain monitors for all configured chains (fire-and-forget)
  for (const chain of CHAINS) {
    const chainConfig = config.chains[chain];
    if (!chainConfig) continue;

    startMerkleSync(chain, chainConfig, db).catch((err) =>
      console.error(`[chain-sync] merkle-sync failed for ${chain}:`, err)
    );

    startNullifierSync(chain, chainConfig, db).catch((err) =>
      console.error(`[chain-sync] nullifier-sync failed for ${chain}:`, err)
    );
  }
}

main().catch((err) => {
  console.error('[chain-sync] Fatal startup error:', err);
  process.exit(1);
});

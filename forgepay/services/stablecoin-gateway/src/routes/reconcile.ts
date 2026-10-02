/**
 *   GET  /reconcile        the last reconciliation report (admin)
 *   POST /reconcile/run    run one now and return it (admin)
 */
import type { FastifyInstance } from 'fastify';
import { reconcileNow, lastReport } from '../lib/reconcile-runner.js';

export async function buildReconcileRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (req.auth?.kind !== 'admin') return reply.code(403).send({ error: 'Forbidden', message: 'reconciliation is an operator view' });
  });
  app.get('/', async (_req, reply) => reply.send({ report: lastReport() ?? null }));
  app.post('/run', async (_req, reply) => reply.send({ report: await reconcileNow() }));
}

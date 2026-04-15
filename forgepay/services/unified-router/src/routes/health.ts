import type { FastifyInstance } from 'fastify';

export async function buildHealthRoutes(app: FastifyInstance) {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (req, reply) => {
    // Check Redis and Postgres connectivity
    try {
      await (req.server as { redis: { ping: () => Promise<string> } }).redis.ping();
      await (req.server as { db: { query: (sql: string) => Promise<unknown> } }).db.query('SELECT 1');
      reply.send({ status: 'ready' });
    } catch (err) {
      reply.code(503).send({ status: 'not_ready', error: String(err) });
    }
  });
}

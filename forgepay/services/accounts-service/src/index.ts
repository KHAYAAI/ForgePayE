import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { config } from './config.js';
import { getDb } from './lib/db.js';
import { buildAccountRoutes } from './routes/accounts.js';
import { buildTransactionRoutes } from './routes/transactions.js';
import { buildWebhookRoutes } from './routes/webhooks.js';

const app = Fastify({ logger: true });

await app.register(helmet);

await app.register(cors, {
  origin: config.corsAllowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
});

await app.register(rateLimit, {
  max:        200,
  timeWindow: '1 minute',
  errorResponseBuilder: () => ({
    statusCode: 429,
    error:      'Too Many Requests',
    message:    'Rate limit exceeded. Please slow down.',
  }),
});

// Health + readiness
app.get('/healthz', async () => ({ status: 'ok', service: 'accounts-service', version: '0.1.0' }));

app.get('/readyz', async (_req, reply) => {
  try {
    await getDb().query('SELECT 1');
    reply.send({ status: 'ready' });
  } catch {
    reply.code(503).send({ status: 'not_ready', error: 'Database unavailable' });
  }
});

// API routes
await app.register(buildAccountRoutes,     { prefix: '/v1/accounts' });
await app.register(buildTransactionRoutes, { prefix: '/v1/accounts' });
await app.register(buildWebhookRoutes,     { prefix: '/v1/webhooks' });

// Start
try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`accounts-service listening on :${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    app.log.info(`Received ${signal} — shutting down`);
    await app.close();
    process.exit(0);
  });
}

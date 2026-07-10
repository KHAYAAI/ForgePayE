import Fastify, { FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { config } from './config.js';
import { getDb } from './lib/db.js';
import { buildAccountRoutes } from './routes/accounts.js';
import { buildTransactionRoutes } from './routes/transactions.js';
import { buildWebhookRoutes } from './routes/webhooks.js';

const app = Fastify({ logger: true });

// ── Raw body capture ──────────────────────────────────────────────────────
// routes/webhooks.ts verifies the Circle webhook's HMAC signature over the
// *exact* bytes received (reads `req.rawBody`). Fastify's default JSON parser
// discards the raw buffer after parsing, so without this the buffer is
// always undefined and every webhook is rejected as "missing_body" — this
// parser is what makes that verification real.
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body: Buffer, done) => {
    (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body;
    if (body.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  },
);

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

app.get('/metrics', async (_req, reply) => {
  const { Metrics } = await import('./lib/metrics.js');
  reply.type('text/plain; version=0.0.4; charset=utf-8').send(await Metrics.register());
});

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

// Global error handlers (prevent silent pod crashes)
process.on('unhandledRejection', (reason, promise) => {
  console.error('[accounts-service] Unhandled Rejection:', reason, promise);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[accounts-service] Uncaught Exception:', error);
  process.exit(1);
});

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

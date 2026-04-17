/**
 * Event query API — allows the dashboard and merchants to query the event log.
 *
 * Auth: Bearer token required. The token must match the merchant's signing secret
 * stored in merchant_webhook_endpoints, OR be the internal auth secret for
 * dashboard proxy calls (which inject it server-side via the Next.js API layer).
 */

import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

type DbPool = { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> };

export async function buildEventRoutes(app: FastifyInstance) {
  // List events for a merchant (paginated)
  app.get<{
    Querystring: {
      merchant_id: string;
      limit?:      string;
      before?:     string;
      type?:       string;
    };
  }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['merchant_id'],
          properties: {
            merchant_id: { type: 'string' },
            limit:       { type: 'string' },
            before:      { type: 'string' },
            type:        { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      // ── Auth check ──────────────────────────────────────────────────────────
      const authHeader = req.headers.authorization ?? '';
      if (!authHeader.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'Missing Bearer token' });
        return;
      }
      const token = authHeader.slice(7);

      // Accept either the internal dashboard secret or a valid merchant API key.
      const isInternal = token === config.internalWebhookSecret;
      if (!isInternal) {
        // Validate that the token matches a signing secret for this merchant.
        const db = (req.server as { db: DbPool }).db;
        const check = await db.query(
          `SELECT 1 FROM merchant_webhook_endpoints
            WHERE merchant_id = $1
              AND signing_secret = $2
              AND enabled = true
            LIMIT 1`,
          [req.query.merchant_id, token],
        );
        if (check.rows.length === 0) {
          reply.code(401).send({ error: 'Unauthorized' });
          return;
        }
      }

      // ── Query ───────────────────────────────────────────────────────────────
      const { merchant_id, limit = '50', before, type } = req.query;
      const db = (req.server as { db: DbPool }).db;

      const limitNum = Math.min(parseInt(limit, 10), 200);
      const params: unknown[] = [merchant_id, limitNum];
      let sql = `
        SELECT id, type, source, occurred_at, data
        FROM forgepay_events
        WHERE merchant_id = $1
      `;

      if (type) {
        sql += ` AND type = $${params.length + 1}`;
        params.push(type);
      }

      if (before) {
        sql += ` AND occurred_at < $${params.length + 1}`;
        params.push(before);
      }

      sql += ` ORDER BY occurred_at DESC LIMIT $2`;

      const result = await db.query(sql, params);
      reply.send({ data: result.rows, count: result.rows.length });
    },
  );

  // ── Webhook endpoint management ─────────────────────────────────────────────

  // GET /events/webhook-endpoints — list merchant endpoints (used by dashboard)
  app.get<{ Querystring: { merchant_id?: string } }>(
    '/webhook-endpoints',
    async (req, reply) => {
      const authHeader = req.headers.authorization ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (token !== config.internalWebhookSecret && token !== req.headers['x-internal-auth']) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      const db = (req.server as { db: DbPool }).db;
      const result = await db.query(
        `SELECT id, merchant_id, endpoint_url, enabled, created_at
           FROM merchant_webhook_endpoints
          ORDER BY created_at DESC`,
        [],
      );
      reply.send({ data: result.rows });
    },
  );

  // POST /events/webhook-endpoints — register a new endpoint
  app.post<{ Body: { url: string; merchant_id?: string; description?: string } }>(
    '/webhook-endpoints',
    {
      schema: {
        body: {
          type: 'object',
          required: ['url'],
          properties: {
            url:         { type: 'string', format: 'uri' },
            merchant_id: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const authHeader = req.headers.authorization ?? '';
      const xInternal  = req.headers['x-internal-auth'] as string ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : xInternal;
      if (token !== config.internalWebhookSecret) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      const { url, merchant_id = 'default', description } = req.body;
      const signingSecret = crypto.randomUUID().replace(/-/g, '');

      const db = (req.server as { db: DbPool }).db;
      const result = await db.query(
        `INSERT INTO merchant_webhook_endpoints
           (id, merchant_id, endpoint_url, signing_secret, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, now(), now())
         RETURNING id, merchant_id, endpoint_url, enabled, created_at`,
        [crypto.randomUUID(), merchant_id, url, signingSecret],
      );

      reply.code(201).send({
        ...(result.rows[0] as object),
        signing_secret: signingSecret,
        description,
      });
    },
  );
}

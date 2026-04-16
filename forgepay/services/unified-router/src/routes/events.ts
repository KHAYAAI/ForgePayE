/**
 * Event query API — allows the dashboard and merchants to query the event log.
 *
 * LAUNCH BLOCKER: This route has NO authentication. Any caller who knows a
 * merchant_id can read that merchant's full event history (payment amounts,
 * customer IDs, etc.). This is a data-privacy and PCI scope violation.
 *
 * To fix, add an API key or JWT check before executing the DB query:
 *   const authHeader = req.headers.authorization;
 *   if (!authHeader?.startsWith('Bearer ')) { reply.code(401).send(...); return; }
 *   const apiKey = authHeader.slice(7);
 *   // Look up apiKey in the merchant_api_keys table, verify it matches merchant_id.
 *
 * The dashboard calls this via the Next.js API proxy (src/app/api/), which injects
 * the key server-side, so the fix should not break the dashboard flow.
 */

import type { FastifyInstance } from 'fastify';

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
      const { merchant_id, limit = '50', before, type } = req.query;
      const db = (req.server as { db: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> } }).db;

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
}

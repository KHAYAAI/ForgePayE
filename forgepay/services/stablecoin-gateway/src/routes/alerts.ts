/**
 * Operator routes for alerting. Admin-only.
 *
 *   GET  /alerts        where alerts go, what is currently active, recent deliveries and failures
 *   POST /alerts/test   send a test warning through the real destinations (do this after configuring them)
 */
import type { FastifyInstance } from 'fastify';
import { alerts } from '../lib/alerts.js';

export async function buildAlertRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    if (req.auth?.kind !== 'admin') return reply.code(403).send({ error: 'Forbidden', message: 'alerting is an operator view' });
    const st = alerts().status();
    return reply.send({ ...st, note: st.destinations.length ? undefined : 'No destination is configured: alerts only reach the log. Set ALERT_WEBHOOK_URL and/or ALERT_PAGERDUTY_ROUTING_KEY.' });
  });

  app.post('/test', async (req, reply) => {
    if (req.auth?.kind !== 'admin') return reply.code(403).send({ error: 'Forbidden', message: 'alerting is an operator action' });
    const a = alerts();
    const key = `test:${Date.now()}`;
    await a.raise(key, 'warning', 'Test alert from the stablecoin gateway', 'If you can read this, warning alerts reach you. Critical alerts also go to PagerDuty when configured.');
    await a.resolve(key, 'test finished');
    const sent = a.status().recent.find((r) => r.key === key && r.event === 'trigger');
    return reply.send({ destinations: a.status().destinations, delivered: sent?.delivered ?? [], failed: sent?.failed ?? [] });
  });
}

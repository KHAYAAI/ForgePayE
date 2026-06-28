import type { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';

const PRODUCT_MAP: Record<string, string> = {
  '/v1/payments': 'payments',
  '/v1/treasury': 'treasury',
  '/v1/credit-bureau': 'credit-bureau',
};

export async function requireProductMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const customerId = (request.user as any)?.customerId;
  const tenantId = (request.user as any)?.tenantId;
  const pathname = request.url.split('?')[0];

  const requiredProduct = Object.entries(PRODUCT_MAP).find(([prefix]) =>
    pathname.startsWith(prefix)
  )?.[1];

  if (!requiredProduct) {
    return;
  }

  try {
    const customer = await db.query(
      tenantId,
      `SELECT products FROM customers WHERE id = $1`,
      [customerId]
    );

    const products = customer.rows[0]?.products || [];

    if (!products.includes(requiredProduct)) {
      await db.query(
        tenantId,
        `INSERT INTO revenue_events 
         (customer_id, tenant_id, product, event_type, metadata, event_timestamp)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          customerId,
          tenantId,
          requiredProduct,
          'LICENSING_DENIED',
          JSON.stringify({
            reason: 'unlicensed_product_access',
            requested_product: requiredProduct,
            endpoint: pathname,
            timestamp: new Date().toISOString(),
          }),
        ]
      );

      return reply.status(403).send({
        error: 'unlicensed_product',
        upgrade_url: `https://forgepay.com/checkout/${requiredProduct}`,
        message: `You don't have access to ${requiredProduct}. Upgrade to unlock.`,
      });
    }
  } catch (err) {
    console.error('requireProduct middleware error:', err);
    return reply.status(500).send({ error: 'internal_server_error' });
  }
}

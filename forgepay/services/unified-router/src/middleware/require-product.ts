import type { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';

const PRODUCT_MAP: Record<string, string> = {
  '/v1/payments': 'payments',
  '/v1/treasury': 'treasury',
  '/v1/credit-bureau': 'credit-bureau',
};

/**
 * Whether entitlement checks actually block requests.
 *
 * Deliberately opt-in. `POST /v1/payments` is matched by PRODUCT_MAP below and
 * is the one payment route this service serves; no customer currently has
 * `products` populated, so switching enforcement on before customers are
 * provisioned would 403 every payment call. That is an outage, not a fix.
 *
 * Set ENFORCE_PRODUCT_ENTITLEMENTS=true once customers carry their products —
 * the code path is live and tested either way, so this is a flag flip rather
 * than a deploy of untested code. Until then the middleware records the denial
 * it *would* have issued (LICENSING_DENIED in revenue_events, which is how
 * unlicensed demand gets measured) and lets the request through.
 */
function enforcementEnabled(): boolean {
  return process.env['ENFORCE_PRODUCT_ENTITLEMENTS'] === 'true';
}

export async function requireProductMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const customerId = request.user?.customerId;
  const tenantId = request.user?.tenantId;
  const pathname = request.url.split('?')[0];

  const requiredProduct = Object.entries(PRODUCT_MAP).find(([prefix]) =>
    pathname.startsWith(prefix)
  )?.[1];

  if (!requiredProduct) {
    return;
  }

  // No customer context means there is no entitlement to evaluate. This is the
  // operator key, which acts across customers and is not licensed per product.
  //
  // Reaching here with neither an operator nor a customer would mean an
  // unauthenticated request got past the auth hook, so fail closed rather than
  // silently allowing it — previously `(request.user as any).customerId` made
  // this case a `SELECT ... WHERE id = undefined`, which matches nothing and
  // therefore denied every product to a caller it could not identify.
  if (!customerId || !tenantId) {
    if (request.auth?.kind === 'operator') return;
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'No customer context on this request.',
    });
  }

  try {
    const customer = await db.query<{ products: string[] | null }>(
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

      if (!enforcementEnabled()) {
        // Denial recorded above, request allowed through. See enforcementEnabled().
        return;
      }

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

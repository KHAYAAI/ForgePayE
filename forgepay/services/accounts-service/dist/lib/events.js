import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
export function buildEvent(type, merchantId, accountId, data) {
    return {
        eventId: randomUUID(),
        type,
        merchantId,
        accountId,
        data,
        occurredAt: new Date().toISOString(),
    };
}
export async function forwardToUnifiedRouter(event) {
    const body = JSON.stringify(event);
    const signature = createHmac('sha256', config.internalWebhookSecret).update(body).digest('hex');
    try {
        const res = await fetch(`${config.unifiedRouterUrl}/webhooks/accounts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-forgepay-sig': `sha256=${signature}`,
                'x-forgepay-source': 'accounts-service',
            },
            body,
            signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
            console.error('[events] Failed to forward account event to unified-router:', res.status, event.type);
        }
    }
    catch (err) {
        console.error('[events] Error forwarding account event:', event.type, err);
    }
}
//# sourceMappingURL=events.js.map
import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export type AccountEventType =
  | 'account.created'
  | 'account.kyc.submitted'
  | 'account.kyc.approved'
  | 'account.kyc.rejected'
  | 'account.deposit.initiated'
  | 'account.deposit.confirmed'
  | 'account.deposit.failed'
  | 'account.withdrawal.initiated'
  | 'account.withdrawal.confirmed'
  | 'account.withdrawal.failed'
  | 'account.transfer.completed'
  | 'account.fraud.blocked';

export interface AccountEvent {
  eventId:    string;
  type:       AccountEventType;
  merchantId: string;
  accountId:  string;
  data:       Record<string, unknown>;
  occurredAt: string;
}

export function buildEvent(
  type: AccountEventType,
  merchantId: string,
  accountId: string,
  data: Record<string, unknown>,
): AccountEvent {
  return {
    eventId:    randomUUID(),
    type,
    merchantId,
    accountId,
    data,
    occurredAt: new Date().toISOString(),
  };
}

export async function forwardToUnifiedRouter(event: AccountEvent): Promise<void> {
  const body      = JSON.stringify(event);
  const signature = createHmac('sha256', config.internalWebhookSecret).update(body).digest('hex');

  try {
    const res = await fetch(`${config.unifiedRouterUrl}/webhooks/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-forgepay-sig':    `sha256=${signature}`,
        'x-forgepay-source': 'accounts-service',
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.error('[events] Failed to forward account event to unified-router:', res.status, event.type);
    }
  } catch (err) {
    console.error('[events] Error forwarding account event:', event.type, err);
  }
}

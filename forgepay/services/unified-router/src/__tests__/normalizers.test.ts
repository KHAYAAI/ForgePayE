/**
 * Tests for all four webhook normalizers.
 * Verifies that raw payloads from each source map correctly to canonical ForgePayEvents.
 */

import { describe, it, expect } from 'vitest';
import { normalizeHyperswitchEvent } from '../normalizers/hyperswitch.js';
import { normalizeKillBillEvent }    from '../normalizers/killbill.js';
import { normalizeStablecoinEvent }  from '../normalizers/stablecoin.js';
import { normalizeCryptoEvent }      from '../normalizers/crypto.js';

// ── Hyperswitch normalizer ────────────────────────────────────────────────────

describe('normalizeHyperswitchEvent', () => {
  const baseEvent = {
    event_id:    'evt_hs_001',
    merchant_id: 'merch_01',
    created:     '2026-04-15T10:00:00Z',
    content: {
      object: {
        payment_id: 'pay_01',
        amount:     4900,
        currency:   'USD',
        status:     'succeeded',
        customer_id: 'cus_01',
        metadata:   { order_id: 'ord_01' },
      },
    },
  };

  it('maps payment_intent.succeeded → payment.succeeded', () => {
    const event = normalizeHyperswitchEvent({
      ...baseEvent,
      event_type: 'payment_intent.succeeded',
    });

    expect(event).not.toBeNull();
    expect(event!.type).toBe('payment.succeeded');
    expect(event!.source).toBe('payment-engine');
    expect(event!.merchantId).toBe('merch_01');
    expect(event!.sourceEventId).toBe('evt_hs_001');
    expect(event!.apiVersion).toBe('2026-04');
  });

  it('converts cents to decimal amount string', () => {
    const event = normalizeHyperswitchEvent({
      ...baseEvent,
      event_type: 'payment_intent.succeeded',
    });
    const data = event!.data as { amount: { value: string; currency: string } };
    expect(data.amount.value).toBe('49.00');
    expect(data.amount.currency).toBe('USD');
  });

  it('maps payment_intent.payment_failed → payment.failed', () => {
    const event = normalizeHyperswitchEvent({
      ...baseEvent,
      event_type: 'payment_intent.payment_failed',
      content: { object: { ...baseEvent.content.object, status: 'failed', error_message: 'Declined' } },
    });
    expect(event!.type).toBe('payment.failed');
    const data = event!.data as { failureReason: string };
    expect(data.failureReason).toBe('Declined');
  });

  it('returns null for unrecognised event types', () => {
    const event = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'some_unknown_event' });
    expect(event).toBeNull();
  });

  it('maps refund.succeeded → payment.refunded', () => {
    const event = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'refund.succeeded' });
    expect(event!.type).toBe('payment.refunded');
  });

  it('generates a unique UUID for each event', () => {
    const e1 = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'payment_intent.succeeded' });
    const e2 = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'payment_intent.succeeded' });
    expect(e1!.id).not.toBe(e2!.id);
  });
});

// ── Kill Bill normalizer ──────────────────────────────────────────────────────

describe('normalizeKillBillEvent', () => {
  const baseKbEvent = {
    eventType:       'SUBSCRIPTION_CREATION',
    accountId:       'kb_acc_01',
    tenantId:        'merch_01',
    subscriptionId:  'kb_sub_01',
    userToken:       'kb_user_token_01',
    eventDate:       '2026-04-15T10:00:00Z',
  };

  it('maps SUBSCRIPTION_CREATION → subscription.created', () => {
    const event = normalizeKillBillEvent(baseKbEvent);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('subscription.created');
    expect(event!.source).toBe('billing-engine');
    expect(event!.merchantId).toBe('merch_01');
  });

  it('maps PAYMENT_SUCCESS → invoice.paid', () => {
    const event = normalizeKillBillEvent({ ...baseKbEvent, eventType: 'PAYMENT_SUCCESS' });
    expect(event!.type).toBe('invoice.paid');
  });

  it('maps PAYMENT_FAILED → invoice.payment_failed', () => {
    const event = normalizeKillBillEvent({ ...baseKbEvent, eventType: 'PAYMENT_FAILED' });
    expect(event!.type).toBe('invoice.payment_failed');
  });

  it('maps OVERDUE_CHANGE → subscription.past_due', () => {
    const event = normalizeKillBillEvent({ ...baseKbEvent, eventType: 'OVERDUE_CHANGE' });
    expect(event!.type).toBe('subscription.past_due');
  });

  it('uses userToken as sourceEventId for idempotency', () => {
    const event = normalizeKillBillEvent(baseKbEvent);
    expect(event!.sourceEventId).toBe('kb_user_token_01');
  });

  it('returns null for unknown Kill Bill events', () => {
    const event = normalizeKillBillEvent({ ...baseKbEvent, eventType: 'SOME_FUTURE_EVENT' });
    expect(event).toBeNull();
  });
});

// ── Stablecoin normalizer ─────────────────────────────────────────────────────

describe('normalizeStablecoinEvent', () => {
  const baseStablecoinEvent = {
    id:          'sc_evt_01',
    event:       'payment.confirmed',
    merchant_id: 'merch_01',
    payment: {
      id:             'sc_pay_01',
      amount:         '49.00',
      currency:       'USDC',
      chain:          'base',
      status:         'confirmed',
      wallet_address: '0xdeadbeef',
      tx_hash:        '0xabc123',
      confirmations:  12,
      fiat_amount:    '49.00',
      fiat_currency:  'USD',
    },
    created_at: '2026-04-15T10:00:00Z',
  };

  it('maps payment.confirmed → crypto_payment.confirmed', () => {
    const event = normalizeStablecoinEvent(baseStablecoinEvent);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('crypto_payment.confirmed');
    expect(event!.source).toBe('stablecoin-gateway');
  });

  it('includes tx_hash and confirmations in data', () => {
    const event = normalizeStablecoinEvent(baseStablecoinEvent);
    const data = event!.data as { txHash: string; confirmations: number; chain: string };
    expect(data.txHash).toBe('0xabc123');
    expect(data.confirmations).toBe(12);
    expect(data.chain).toBe('base');
  });

  it('maps payment.expired → crypto_payment.expired', () => {
    const event = normalizeStablecoinEvent({ ...baseStablecoinEvent, event: 'payment.expired' });
    expect(event!.type).toBe('crypto_payment.expired');
  });

  it('returns null for unknown events', () => {
    expect(normalizeStablecoinEvent({ ...baseStablecoinEvent, event: 'unknown' })).toBeNull();
  });
});

// ── Crypto normalizer ─────────────────────────────────────────────────────────

describe('normalizeCryptoEvent', () => {
  const baseCryptoEvent = {
    id:          'crypto_evt_01',
    event_type:  'payment_confirmed',
    merchant_id: 'merch_01',
    invoice: {
      id:             'inv_01',
      coin:           'BTC',
      amount:         '0.00102',
      address:        '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf',
      tx_hash:        'txhash_abc',
      confirmations:  2,
      status:         'confirmed',
      usd_equivalent: '49.00',
    },
    timestamp: '2026-04-15T10:00:00Z',
  };

  it('maps payment_confirmed → crypto_payment.confirmed', () => {
    const event = normalizeCryptoEvent(baseCryptoEvent);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('crypto_payment.confirmed');
    expect(event!.source).toBe('crypto-gateway');
  });

  it('maps BTC coin to bitcoin chain', () => {
    const event = normalizeCryptoEvent(baseCryptoEvent);
    const data = event!.data as { chain: string };
    expect(data.chain).toBe('bitcoin');
  });

  it('maps ETH coin to ethereum chain', () => {
    const event = normalizeCryptoEvent({
      ...baseCryptoEvent,
      invoice: { ...baseCryptoEvent.invoice, coin: 'ETH' },
    });
    const data = event!.data as { chain: string };
    expect(data.chain).toBe('ethereum');
  });

  it('maps invoice_expired → crypto_payment.expired', () => {
    const event = normalizeCryptoEvent({ ...baseCryptoEvent, event_type: 'invoice_expired' });
    expect(event!.type).toBe('crypto_payment.expired');
  });

  it('returns null for unknown event types', () => {
    expect(normalizeCryptoEvent({ ...baseCryptoEvent, event_type: 'unknown_event' })).toBeNull();
  });
});

/**
 * Tests for all four webhook normalizers.
 * Verifies that raw payloads from each source map correctly to canonical ForgePayEvents.
 */

import { describe, it, expect } from 'vitest';
import { normalizeHyperswitchEvent } from '../src/normalizers/hyperswitch.js';
import { normalizeStablecoinEvent }  from '../src/normalizers/stablecoin.js';
import { normalizeCryptoEvent }      from '../src/normalizers/crypto.js';
import { normalizeKillBillEvent }    from '../src/normalizers/killbill.js';

// ── Hyperswitch normalizer ────────────────────────────────────────────────────

describe('normalizeHyperswitchEvent', () => {
  const baseEvent = {
    event_id:    'evt_hs_001',
    merchant_id: 'merch_01',
    created:     '2026-04-15T10:00:00Z',
    content: {
      object: {
        payment_id:  'pay_01',
        amount:      4900,
        currency:    'USD',
        status:      'succeeded',
        customer_id: 'cus_01',
        metadata:    { order_id: 'ord_01' },
      },
    },
  };

  it('maps payment_intent.succeeded → payment.succeeded', () => {
    const event = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'payment_intent.succeeded' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('payment.succeeded');
    expect(event!.source).toBe('payment-engine');
    expect(event!.merchantId).toBe('merch_01');
    expect(event!.sourceEventId).toBe('evt_hs_001');
  });

  it('maps payment_intent.failed → payment.failed', () => {
    const event = normalizeHyperswitchEvent({
      ...baseEvent,
      event_type: 'payment_intent.failed',
      content: { object: { ...baseEvent.content.object, status: 'failed', error_message: 'Declined' } },
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('payment.failed');
    const data = event!.data as { failureReason: string };
    expect(data.failureReason).toBe('Declined');
  });

  it('maps refund.succeeded → payment.refunded', () => {
    const event = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'refund.succeeded' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('payment.refunded');
  });

  it('returns null for unknown event types', () => {
    const event = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'some_unknown_event' });
    expect(event).toBeNull();
  });

  it('converts integer cents to decimal string (4900 → "49.00")', () => {
    const event = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'payment_intent.succeeded' });
    const data = event!.data as { amount: { value: string; currency: string } };
    expect(data.amount.value).toBe('49.00');
    expect(data.amount.currency).toBe('USD');
  });

  it('sets source to payment-engine', () => {
    const event = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'payment_intent.succeeded' });
    expect(event!.source).toBe('payment-engine');
  });

  it('carries through merchant_id and event_id as sourceEventId', () => {
    const event = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'payment_intent.succeeded' });
    expect(event!.merchantId).toBe('merch_01');
    expect(event!.sourceEventId).toBe('evt_hs_001');
  });

  it('carries through paymentId from content.object', () => {
    const event = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'payment_intent.succeeded' });
    const data = event!.data as { paymentId: string };
    expect(data.paymentId).toBe('pay_01');
  });

  it('generates a UUID v4 id matching /^[0-9a-f-]{36}$/', () => {
    const event = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'payment_intent.succeeded' });
    expect(event!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates a different id for each call', () => {
    const e1 = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'payment_intent.succeeded' });
    const e2 = normalizeHyperswitchEvent({ ...baseEvent, event_type: 'payment_intent.succeeded' });
    expect(e1!.id).not.toBe(e2!.id);
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
  });

  it('sets source to stablecoin-gateway', () => {
    const event = normalizeStablecoinEvent(baseStablecoinEvent);
    expect(event!.source).toBe('stablecoin-gateway');
  });

  it('includes chain and currency from payment object', () => {
    const event = normalizeStablecoinEvent(baseStablecoinEvent);
    const data = event!.data as { chain: string; amount: { currency: string } };
    expect(data.chain).toBe('base');
    expect(data.amount.currency).toBe('USDC');
  });

  it('returns null for unknown events', () => {
    const event = normalizeStablecoinEvent({ ...baseStablecoinEvent, event: 'payment.unknown' });
    expect(event).toBeNull();
  });

  it('generates a UUID v4 id matching /^[0-9a-f-]{36}$/', () => {
    const event = normalizeStablecoinEvent(baseStablecoinEvent);
    expect(event!.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ── Crypto normalizer ─────────────────────────────────────────────────────────

describe('normalizeCryptoEvent', () => {
  const baseCryptoEvent = {
    id:          'crypto_evt_01',
    event_type:  'invoice_created',
    merchant_id: 'merch_01',
    invoice: {
      id:             'inv_01',
      coin:           'BTC',
      amount:         '0.00102',
      address:        '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf',
      confirmations:  0,
      status:         'pending',
    },
    timestamp: '2026-04-15T10:00:00Z',
  };

  it('maps invoice_created → crypto_payment.created', () => {
    const event = normalizeCryptoEvent(baseCryptoEvent);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('crypto_payment.created');
  });

  it('sets source to crypto-gateway', () => {
    const event = normalizeCryptoEvent(baseCryptoEvent);
    expect(event!.source).toBe('crypto-gateway');
  });

  it('returns null for unknown event_type', () => {
    const event = normalizeCryptoEvent({ ...baseCryptoEvent, event_type: 'unknown_event' });
    expect(event).toBeNull();
  });

  it('coinToChain: BTC → bitcoin', () => {
    const event = normalizeCryptoEvent(baseCryptoEvent);
    const data = event!.data as { chain: string };
    expect(data.chain).toBe('bitcoin');
  });

  it('coinToChain: ETH → ethereum', () => {
    const event = normalizeCryptoEvent({
      ...baseCryptoEvent,
      invoice: { ...baseCryptoEvent.invoice, coin: 'ETH' },
    });
    const data = event!.data as { chain: string };
    expect(data.chain).toBe('ethereum');
  });

  it('coinToChain: LTC → litecoin', () => {
    const event = normalizeCryptoEvent({
      ...baseCryptoEvent,
      invoice: { ...baseCryptoEvent.invoice, coin: 'LTC' },
    });
    const data = event!.data as { chain: string };
    expect(data.chain).toBe('litecoin');
  });

  it('coinToChain: unknown coin → lowercase coin symbol', () => {
    const event = normalizeCryptoEvent({
      ...baseCryptoEvent,
      invoice: { ...baseCryptoEvent.invoice, coin: 'MEME' },
    });
    const data = event!.data as { chain: string };
    expect(data.chain).toBe('meme');
  });

  it('generates a UUID v4 id matching /^[0-9a-f-]{36}$/', () => {
    const event = normalizeCryptoEvent(baseCryptoEvent);
    expect(event!.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ── Kill Bill normalizer ──────────────────────────────────────────────────────

describe('normalizeKillBillEvent', () => {
  const baseKbEvent = {
    eventType:      'SUBSCRIPTION_CREATION',
    accountId:      'kb_acc_01',
    tenantId:       'merch_01',
    subscriptionId: 'kb_sub_01',
    userToken:      'kb_user_token_01',
    eventDate:      '2026-04-15T10:00:00Z',
  };

  it('maps SUBSCRIPTION_CREATION → subscription.created', () => {
    const event = normalizeKillBillEvent(baseKbEvent);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('subscription.created');
    expect(event!.source).toBe('billing-engine');
  });

  it('sets source to billing-engine', () => {
    const event = normalizeKillBillEvent(baseKbEvent);
    expect(event!.source).toBe('billing-engine');
  });

  it('maps PAYMENT_SUCCESS → invoice.paid', () => {
    const event = normalizeKillBillEvent({ ...baseKbEvent, eventType: 'PAYMENT_SUCCESS' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('invoice.paid');
  });

  it('returns null for unrecognised eventType', () => {
    const event = normalizeKillBillEvent({ ...baseKbEvent, eventType: 'SOME_FUTURE_EVENT' });
    expect(event).toBeNull();
  });

  it('stub invoice amount is "0.00" for invoice events', () => {
    const event = normalizeKillBillEvent({ ...baseKbEvent, eventType: 'PAYMENT_SUCCESS' });
    const data = event!.data as { amount: { value: string; currency: string } };
    expect(data.amount.value).toBe('0.00');
  });

  it('sets merchantId from tenantId', () => {
    const event = normalizeKillBillEvent(baseKbEvent);
    expect(event!.merchantId).toBe('merch_01');
  });

  it('generates a UUID v4 id matching /^[0-9a-f-]{36}$/', () => {
    const event = normalizeKillBillEvent(baseKbEvent);
    expect(event!.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

/**
 * The escrow ledger against a real Postgres (runs when DATABASE_URL is set).
 *
 * Regressions guarded: balances lived in a Map that was written to Postgres
 * but never read back, so a restart zeroed every balance; and the status
 * check and the write were separate steps, so concurrent releases could both
 * credit the seller.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';

const hasDb = !!process.env['DATABASE_URL'];

describe.skipIf(!hasDb)('escrow ledger on Postgres', () => {
  let store: typeof import('../store');
  let ledger: typeof import('../ledger');
  let escrow: typeof import('../escrow');

  beforeAll(async () => {
    store = await import('../store');
    ledger = await import('../ledger');
    escrow = await import('../escrow');
    await store.initStore();
  });

  async function newEscrow(buyer: string, seller: string, amountUsd: number): Promise<string> {
    const now = new Date().toISOString();
    const sessionId = `s-${randomUUID()}`;
    await store.setSession({
      id: sessionId, initiatorAgentId: buyer, responderAgentId: seller, subject: 'test', status: 'accepted',
      messages: [], totalRounds: 1, maxRounds: 5, createdAt: now, updatedAt: now, expiresAt: now,
    } as never);
    const id = `e-${randomUUID()}`;
    await store.setEscrow({
      id, sessionId, buyerAgentId: buyer, sellerAgentId: seller, amountUsd, asset: 'USDC', chain: 'base',
      status: 'pending', createdAt: now,
    } as never);
    return id;
  }

  it('balances survive a restart (the in-memory state is gone; Postgres is the truth)', async () => {
    const buyer = `b-${randomUUID()}`;
    await ledger.deposit(buyer, 500);
    ledger.resetLedger(); // what a restart did to the old Map
    expect(await ledger.getBalance(buyer)).toBe(500);
  });

  it('concurrent releases pay the seller exactly once', async () => {
    const buyer = `b-${randomUUID()}`, seller = `s-${randomUUID()}`;
    await ledger.deposit(buyer, 300);
    const id = await newEscrow(buyer, seller, 300);
    expect('error' in (await escrow.fundEscrow(id))).toBe(false);
    expect(await ledger.getBalance(buyer)).toBe(0);

    const results = await Promise.all([escrow.releaseEscrow(id), escrow.releaseEscrow(id), escrow.releaseEscrow(id)]);
    expect(results.filter((r) => !('error' in r))).toHaveLength(1);
    expect(await ledger.getBalance(seller)).toBe(300);

    // and a refund after the release moves nothing
    expect('error' in (await escrow.refundEscrow(id, 'late'))).toBe(true);
    expect(await ledger.getBalance(buyer)).toBe(0);
  });

  it('funding with too little balance changes nothing', async () => {
    const buyer = `b-${randomUUID()}`, seller = `s-${randomUUID()}`;
    await ledger.deposit(buyer, 50);
    const id = await newEscrow(buyer, seller, 100);
    const r = await escrow.fundEscrow(id);
    expect('error' in r && r.error).toMatch(/Insufficient/);
    expect(await ledger.getBalance(buyer)).toBe(50);
    expect((await store.getEscrow(id))?.status).toBe('pending');
  });

  it('a dispute cannot land on a released escrow', async () => {
    const buyer = `b-${randomUUID()}`, seller = `s-${randomUUID()}`;
    await ledger.deposit(buyer, 10);
    const id = await newEscrow(buyer, seller, 10);
    await escrow.fundEscrow(id);
    await escrow.releaseEscrow(id);
    expect('error' in (await escrow.disputeEscrow(id, 'x'))).toBe(true);
  });
});

/**
 * Checks the custody agent API against a REAL custody deployment. Skipped unless pointed at one.
 *
 *   CUSTODY_CONTRACT_URL          e.g. https://staging.example.org   (the API gateway origin)
 *   CUSTODY_CONTRACT_AGENT_KEY    an ofb_agent_… key issued for TESTNET use. Never a production key.
 *
 * The read-only checks below move nothing. They confirm the shapes that lib/custody-payout-signer.ts depends on, which the unit tests
 * only know from custody's source via helpers/custody-standin.ts. If one of these fails, the stand-in has drifted from the real
 * service and the unit tests are proving the wrong thing: update the stand-in and the broadcaster together.
 *
 * One more test pays, and runs only when you also set:
 *   CUSTODY_CONTRACT_ALLOW_PAY=true
 *   CUSTODY_CONTRACT_CHAIN_ID     a TESTNET chain id, e.g. 11155111 (Sepolia)
 *   CUSTODY_CONTRACT_TOKEN        symbol of a test token the key may pay, e.g. USDC
 *   CUSTODY_CONTRACT_RECIPIENT    a test address you control
 *   CUSTODY_CONTRACT_AMOUNT       a tiny amount, e.g. 0.01
 * It refuses to run if the chain id is one of the mainnets below.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

const URL_ = process.env['CUSTODY_CONTRACT_URL']?.replace(/\/+$/, '');
const KEY = process.env['CUSTODY_CONTRACT_AGENT_KEY'];
const live = Boolean(URL_ && KEY);
const suite = live ? describe : describe.skip;
const MAINNETS = new Set([1, 10, 56, 137, 8453, 42161, 43114]);

async function call(method: string, path: string, body?: unknown, key = KEY) {
  const res = await fetch(URL_ + path, {
    method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text.slice(0, 200) }; }
  return { status: res.status, json };
}

suite('custody agent API: read-only contract', () => {
  it('GET /agent/me describes the key', async () => {
    const r = await call('GET', '/agent/me');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ agentId: expect.any(String), expiresAt: expect.any(String), remaining24hZar: expect.any(Number) });
    expect(Array.isArray(r.json.allowedTokens)).toBe(true);
  });

  it('GET /agent/tokens lists tokens with chain, decimals and whether the platform can broadcast', async () => {
    const r = await call('GET', '/agent/tokens');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.tokens)).toBe(true);
    for (const t of r.json.tokens) {
      expect(t).toMatchObject({ symbol: expect.any(String), chainId: expect.any(Number), decimals: expect.any(Number) });
      expect(typeof t.platformBroadcasts).toBe('boolean');
    }
  });

  it('an unknown payment id is a 404, so "no record" can be told apart from "in flight"', async () => {
    const r = await call('GET', `/agent/transfers/${randomUUID()}?chainId=1`);
    expect(r.status).toBe(404);
  });

  it('a wrong key is a 401', async () => {
    expect((await call('GET', '/agent/me', undefined, 'ofb_agent_definitely_wrong')).status).toBe(401);
  });

  it('GET /agent/transfers returns the agent\'s history with the statuses the broadcaster understands', async () => {
    const r = await call('GET', '/agent/transfers?limit=20');
    expect(r.status).toBe(200);
    for (const t of r.json.transfers) {
      expect(['reserved', 'spent', 'released', 'refused']).toContain(t.status);
      expect(t).toMatchObject({ requestId: expect.any(String), token: expect.any(String), recipient: expect.any(String) });
    }
  });
});

const payEnabled = live && process.env['CUSTODY_CONTRACT_ALLOW_PAY'] === 'true';
(payEnabled ? describe : describe.skip)('custody agent API: one real testnet payment', () => {
  it('pays once, and asking again with the same key returns the same payment without paying twice', async () => {
    const chainId = Number(process.env['CUSTODY_CONTRACT_CHAIN_ID']);
    expect(Number.isInteger(chainId) && chainId > 0, 'CUSTODY_CONTRACT_CHAIN_ID must be set').toBe(true);
    expect(MAINNETS.has(chainId), `chain ${chainId} is a mainnet; this test only runs on a testnet`).toBe(false);
    const body = {
      token: process.env['CUSTODY_CONTRACT_TOKEN'], recipient: process.env['CUSTODY_CONTRACT_RECIPIENT'],
      amount: process.env['CUSTODY_CONTRACT_AMOUNT'] ?? '0.01', chainId, purpose: 'contract test', idempotencyKey: randomUUID(),
    };
    const first = await call('POST', '/agent/transfers', body);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ broadcast: true, transaction_hash: expect.stringMatching(/^0x[0-9a-fA-F]{64}$/) });
    const again = await call('POST', '/agent/transfers', body);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ replayed: true, transaction_hash: first.json.transaction_hash });
    const status = await call('GET', `/agent/transfers/${body.idempotencyKey}?chainId=${chainId}`);
    expect(status.json).toMatchObject({ status: 'spent', txHash: first.json.transaction_hash });
  });
});

/**
 * FORGE Wallet test suite — auth, key-encryption invariants, transaction
 * signing, routing-tier enforcement, and 2-of-3 social recovery.
 * Runs fully in-memory (no Postgres required).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { decryptPrivateKey, encryptPrivateKey, generateWalletKeypair } from '../src/crypto';
import { resetStore } from '../src/store';

let app: FastifyInstance;

const EMAIL = 'ada@example.com';
const PASSWORD = 'correct-horse-battery';

async function signup(email = EMAIL, password = PASSWORD) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { email, password, name: 'Ada' },
  });
  return res;
}

beforeEach(async () => {
  resetStore();
  app = await buildApp();
});

describe('auth', () => {
  it('signs up, returns a JWT, wallets on three chains, and a did:forge DID', async () => {
    const res = await signup();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.did).toMatch(/^did:forge:user_/);
    const chains = body.wallets.map((w: { blockchain: string }) => w.blockchain).sort();
    expect(chains).toEqual(['ethereum', 'polygon', 'solana']);
  });

  it('rejects duplicate emails and bad logins', async () => {
    await signup();
    expect((await signup()).statusCode).toBe(409);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: EMAIL, password: 'wrong-password' },
    });
    expect(bad.statusCode).toBe(401);

    const good = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().token).toBeTruthy();
  });

  it('rejects unauthenticated wallet access', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/wallets' });
    expect(res.statusCode).toBe(401);
  });
});

describe('key encryption', () => {
  it('never stores the private key in plaintext and round-trips under the password', () => {
    const { privateKeyPem } = generateWalletKeypair();
    const envelope = encryptPrivateKey(privateKeyPem, PASSWORD);
    expect(envelope.ciphertextHex).not.toContain(privateKeyPem);
    expect(Buffer.from(envelope.ciphertextHex, 'hex').toString('utf8')).not.toBe(privateKeyPem);
    expect(decryptPrivateKey(envelope, PASSWORD)).toBe(privateKeyPem);
    expect(() => decryptPrivateKey(envelope, 'wrong-password')).toThrow();
  });
});

describe('transactions', () => {
  it('creates, signs, broadcasts, and confirms a small transfer', async () => {
    const token = (await signup()).json().token as string;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/create',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        to_address: '0xsupplier000000000000000000000000000000001',
        amount: 50,
        currency: 'USDC',
        blockchain: 'polygon',
        password: PASSWORD,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('confirmed');
    expect(body.tx_hash).toBeTruthy();
    expect(body.confirmations).toBe(12);
    expect(body.gas_sponsored_usd).toBeCloseTo(0.1);
  });

  it('refuses institutional-size transfers with a forge-custody route (409)', async () => {
    const token = (await signup()).json().token as string;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/create',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        to_address: '0xsupplier000000000000000000000000000000001',
        amount: 250_000,
        currency: 'USDC',
        blockchain: 'polygon',
        password: PASSWORD,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().route).toBe('forge-custody');
  });

  it('rejects signing with a wrong password', async () => {
    const token = (await signup()).json().token as string;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/create',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        to_address: '0xsupplier000000000000000000000000000000001',
        amount: 10,
        currency: 'USDC',
        blockchain: 'polygon',
        password: 'not-the-password',
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('agent wallets', () => {
  it('provisions did:forge:agent_ wallets behind the platform API key', async () => {
    process.env.AGENT_API_KEY = 'platform-key-for-tests';
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/wallets',
      headers: { 'x-api-key': 'wrong' },
      payload: { name: 'trader-bot', owner_platform: 'forge-payments' },
    });
    expect(denied.statusCode).toBe(401);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/wallets',
      headers: { 'x-api-key': 'platform-key-for-tests' },
      payload: { name: 'trader-bot', owner_platform: 'forge-payments' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.agent.did).toMatch(/^did:forge:agent_/);
    expect(body.signing_secret).toBeTruthy();

    // DID lookup by address works for the Agent Credit Bureau.
    const address = body.wallets[0].address as string;
    const lookup = await app.inject({ method: 'GET', url: `/api/v1/dids/by-address/${address}` });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().type).toBe('agent');
  });
});

describe('social recovery (2-of-3)', () => {
  it('recovers an account after two contact approvals and rotates wallets', async () => {
    const signupBody = (await signup()).json();
    const token = signupBody.token as string;
    const oldAddresses = signupBody.wallets.map((w: { address: string }) => w.address).sort();

    for (const contact of [
      { email: 'mom@example.com', name: 'Mom' },
      { email: 'friend@example.com', name: 'Best Friend' },
      { email: 'brother@example.com', name: 'Brother' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/contacts',
        headers: { authorization: `Bearer ${token}` },
        payload: contact,
      });
      expect(res.statusCode).toBe(201);
    }

    const initiated = await app.inject({
      method: 'POST',
      url: '/api/v1/recovery/initiate',
      payload: { email: EMAIL },
    });
    expect(initiated.statusCode).toBe(202);
    const { request_id, dev_tokens } = initiated.json();
    expect(dev_tokens).toHaveLength(3);

    // One approval is not enough.
    const first = await app.inject({ method: 'POST', url: `/api/v1/recovery/approve/${dev_tokens[0].token}` });
    expect(first.json().status).toBe('pending');

    const premature = await app.inject({
      method: 'POST',
      url: '/api/v1/recovery/complete',
      payload: { request_id, new_password: 'brand-new-password-1' },
    });
    expect(premature.statusCode).toBe(409);

    // Second approval crosses the 2-of-3 threshold.
    const second = await app.inject({ method: 'POST', url: `/api/v1/recovery/approve/${dev_tokens[1].token}` });
    expect(second.json().status).toBe('approved');

    // Tokens are single-use.
    const replay = await app.inject({ method: 'POST', url: `/api/v1/recovery/approve/${dev_tokens[0].token}` });
    expect(replay.statusCode).toBe(400);

    const completed = await app.inject({
      method: 'POST',
      url: '/api/v1/recovery/complete',
      payload: { request_id, new_password: 'brand-new-password-1' },
    });
    expect(completed.statusCode).toBe(200);
    const newAddresses = completed
      .json()
      .wallets.map((w: { address: string }) => w.address)
      .sort();
    expect(newAddresses).not.toEqual(oldAddresses); // keys rotated

    // Old password no longer works; the new one does.
    const oldLogin = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: EMAIL, password: PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: EMAIL, password: 'brand-new-password-1' },
    });
    expect(newLogin.statusCode).toBe(200);
  });
});

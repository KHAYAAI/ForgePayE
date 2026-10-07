/**
 * A Solana agent through the real HTTP routes: registered under did:forge:sol:<key>, stored with its address, never mixed up with
 * an EVM identity, and given Mode 2 from indexed Solana activity when the indexer is on.
 */
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';
import { getProfile } from './store';
import { hydrateActivity, resetActivity, setConfiguredChains, type SolanaChainConfig } from './onchain-activity';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)]! + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out;
}
const fresh = () => {
  const spki = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' });
  return base58Encode(new Uint8Array(spki.subarray(spki.length - 32)));
};

const ADMIN = 'dev-bureau-admin-key';
const headers = { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' };
const SAVED = { ...process.env };
let app: FastifyInstance;

beforeEach(async () => {
  delete process.env['STABLECOIN_GATEWAY_URL']; delete process.env['SETTLEMENT_PRIVATE_KEY']; delete process.env['ONCHAIN_INDEXER_ENABLED'];
  resetActivity(); setConfiguredChains([]);
  app = await buildApp(); await app.ready();
});
afterEach(async () => { await app.close(); process.env = { ...SAVED }; resetActivity(); setConfiguredChains([]); });

const register = (agentId: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/v1/agents/${agentId}/profile`, headers, payload: JSON.stringify({ agentId, operatorEntityId: 'op-1', operatorEntityType: 'llc', ...body }) });

describe('registering a Solana agent', () => {
  it('accepts did:forge:sol:<key>, derives the address from it, and starts at the floor', async () => {
    const key = fresh();
    const res = await register('sol_agent_1', { did: `did:forge:sol:${key}` });
    expect(res.statusCode).toBe(201);
    expect(getProfile('sol_agent_1')).toMatchObject({ did: `did:forge:sol:${key}`, solanaAddress: key, currentScore: 300 });
    expect(getProfile('sol_agent_1')!.evmAddress).toBeUndefined();
  });

  it('accepts an explicit solanaAddress that agrees with the DID, and refuses one that contradicts it', async () => {
    const a = fresh(); const b = fresh();
    expect((await register('sol_agent_2', { did: `did:forge:sol:${a}`, solanaAddress: a })).statusCode).toBe(201);
    const bad = await register('sol_agent_3', { did: `did:forge:sol:${a}`, solanaAddress: b });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/contradicts/);
    expect(getProfile('sol_agent_3')).toBeUndefined();
  });

  it('refuses a malformed Solana DID or address at the door', async () => {
    expect((await register('sol_bad_1', { did: 'did:forge:sol:notanaddress' })).statusCode).toBe(400);
    expect((await register('sol_bad_2', { did: 'did:forge:agent_x', solanaAddress: '0x' + '1'.repeat(40) })).statusCode).toBe(400);
  });

  it('is not settled on-chain, and says why in the settlement view of the dual score', async () => {
    const key = fresh();
    await register('sol_agent_4', { did: `did:forge:sol:${key}` });
    const res = await app.inject({ method: 'GET', url: '/v1/agents/sol_agent_4/dual-score', headers });
    const data = res.json().data;
    expect(data.settlement).toMatchObject({ eligible: false, reason: 'no_evm_address' });
    expect(data.settlement.detail).toMatch(/Solana wallet/);
  });

  it('an EVM agent is unaffected: same DID form, address derived as before', async () => {
    const res = await register('evm_agent_1', { did: 'did:forge:0x' + 'ab'.repeat(20) });
    expect(res.statusCode).toBe(201);
    expect(getProfile('evm_agent_1')!.solanaAddress).toBeUndefined();
    expect(getProfile('evm_agent_1')!.evmAddress).toBeDefined();
  });
});

describe('Mode 2 for a Solana agent when the indexer is on', () => {
  const CFG: SolanaChainConfig = { kind: 'solana', chainId: 101, name: 'Solana', rpcUrl: 'https://rpc.example.org', pageSize: 50, tokens: [] };

  it('is unavailable, with the reason, until the wallet has been read and has enough history', async () => {
    process.env['ONCHAIN_INDEXER_ENABLED'] = 'true'; setConfiguredChains([CFG]);
    const key = fresh();
    await register('sol_agent_5', { did: `did:forge:sol:${key}` });

    const before = (await app.inject({ method: 'GET', url: '/v1/agents/sol_agent_5/dual-score', headers })).json().data;
    expect(before.mode2).toBeNull();
    expect(before.mode2Unavailable).toMatchObject({ reason: 'not_indexed_yet' });

    hydrateActivity([{ address: key, chainId: 101, cursor: 0, transferCount: 2, inboundCount: 2, outboundCount: 0, volumeCents: 500, counterparties: [fresh()], firstSeenBlock: 1, firstSeenAt: '2026-01-01T00:00:00.000Z', indexedAt: '2026-10-07T00:00:00.000Z', lastError: null }]);
    const thin = (await app.inject({ method: 'GET', url: '/v1/agents/sol_agent_5/dual-score', headers })).json().data;
    expect(thin.mode2).toBeNull();
    expect(thin.mode2Unavailable).toMatchObject({ reason: 'insufficient_history' });
  });

  it('is scored from the indexed activity, says which chain it came from, and leaves out the success rate', async () => {
    process.env['ONCHAIN_INDEXER_ENABLED'] = 'true'; setConfiguredChains([CFG]);
    const key = fresh();
    await register('sol_agent_6', { did: `did:forge:sol:${key}` });
    hydrateActivity([{
      address: key, chainId: 101, cursor: 0, transferCount: 40, inboundCount: 25, outboundCount: 15, volumeCents: 5_000_000,
      counterparties: [fresh(), fresh(), fresh(), fresh()], firstSeenBlock: 1, firstSeenAt: '2025-01-01T00:00:00.000Z', indexedAt: '2026-10-07T00:00:00.000Z', lastError: null,
    }]);
    const data = (await app.inject({ method: 'GET', url: '/v1/agents/sol_agent_6/dual-score', headers })).json().data;
    expect(data.mode2.score).toBeGreaterThanOrEqual(300);
    expect(data.mode2.factors.some((f: { code: string }) => f.code === 'SUCCESS_RATE_UNKNOWN')).toBe(true);
    expect(data.mode2Source).toMatchObject({ kind: 'indexed_wallet_activity' });
    expect(data.mode2Source.chains[0]).toMatchObject({ chainId: 101, name: 'Solana' });
    expect(data.mode2Unavailable).toBeUndefined();
  });
});

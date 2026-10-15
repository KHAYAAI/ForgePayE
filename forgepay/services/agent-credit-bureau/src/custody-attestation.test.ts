/**
 * Custody attestations. What matters here is what is REFUSED: a forged or altered statement, one about someone else's wallet, a stale
 * or replayed one, and one that lowers a lifetime count. And that withdrawing consent really erases it.
 */
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';
import { getProfile } from './store';
import type { AgentCreditProfile } from './types';
import {
  attestationKeys, custodySignals, getAttestation, hydrateAttestations, parsePayload, refuseIfRegressive, resetAttestations,
  setAttestationPersistence, verifyAttestation, type AttestationPayload, type StoredAttestation,
} from './custody-attestation';
import { hydrateActivity, resetActivity, setConfiguredChains, type ChainConfig } from './onchain-activity';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const WALLET = '0x' + '12'.repeat(20);
const OTHER_WALLET = '0x' + '34'.repeat(20);

function newKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return { privateKey, pub: Buffer.from(spki.subarray(spki.length - 32)).toString('base64') };
}
const custodyKey = newKey();
const otherKey = newKey();

function body(over: Partial<AttestationPayload> = {}, record: Partial<AttestationPayload['record']> = {}): AttestationPayload {
  return {
    version: 1, issuer: 'forge-custody', issuedAt: '2026-10-15T11:00:00.000Z', expiresAt: '2026-10-22T11:00:00.000Z',
    custodyCustomerId: 'cust_1', agentId: 'cag_1', keyAddress: WALLET, agentStatus: 'active',
    record: { transfers: 40, released: 2, refused: 3, refusalsByReason: { 'over daily budget': 1, 'recipient not allowed': 2 }, ...record },
    ...over,
  };
}
const envelope = (p: unknown, key: KeyObject = custodyKey.privateKey) => {
  const text = typeof p === 'string' ? p : JSON.stringify(p);
  return { payload: text, signature: sign(null, Buffer.from(text, 'utf8'), key).toString('base64') };
};
const profile = { agentId: 'agent_1', did: `did:forge:${WALLET}`, evmAddress: WALLET } as AgentCreditProfile;
const ENV = { CUSTODY_ATTESTATION_PUBLIC_KEYS: custodyKey.pub } as unknown as NodeJS.ProcessEnv;
const verify = (e: unknown, p = profile, now = NOW, env = ENV) => verifyAttestation(e, p, now, env);
const stored = (over: Partial<StoredAttestation> = {}): StoredAttestation => ({ ...body(), bureauAgentId: 'agent_1', submittedBy: 'op@example.org', receivedAt: '2026-10-15T11:05:00.000Z', ...over });

beforeEach(() => { resetAttestations(); setAttestationPersistence(null); });

describe('configuration', () => {
  it('is off without keys, and refuses a malformed key list loudly', () => {
    expect(attestationKeys({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(attestationKeys(ENV)).toHaveLength(1);
    expect(attestationKeys({ CUSTODY_ATTESTATION_PUBLIC_KEYS: `${custodyKey.pub}, ${otherKey.pub}` } as unknown as NodeJS.ProcessEnv)).toHaveLength(2);
    expect(() => attestationKeys({ CUSTODY_ATTESTATION_PUBLIC_KEYS: 'AAAA' } as unknown as NodeJS.ProcessEnv)).toThrow(/32-byte/);
    expect(verify(envelope(body()), profile, NOW, {} as NodeJS.ProcessEnv)).toMatchObject({ ok: false, code: 'unconfigured' });
  });
});

describe('verifying an attestation', () => {
  it('accepts a correctly signed, fresh statement about this agent\'s own wallet, in any case', () => {
    expect(verify(envelope(body()))).toMatchObject({ ok: true, payload: { agentId: 'cag_1', record: { transfers: 40 } } });
    expect(verify(envelope(body({ keyAddress: WALLET.toUpperCase().replace('0X', '0x') })))).toMatchObject({ ok: true });
  });

  it('accepts a signature from any configured key, so the key can be rotated', () => {
    const both = { CUSTODY_ATTESTATION_PUBLIC_KEYS: `${otherKey.pub},${custodyKey.pub}` } as unknown as NodeJS.ProcessEnv;
    expect(verify(envelope(body()), profile, NOW, both).ok).toBe(true);
    expect(verify(envelope(body(), otherKey.privateKey), profile, NOW, both).ok).toBe(true);
  });

  it('refuses a statement signed by anyone else, or altered after signing, or with a damaged signature', () => {
    expect(verify(envelope(body(), otherKey.privateKey))).toMatchObject({ ok: false, code: 'bad_signature' });
    const e = envelope(body());
    expect(verify({ ...e, payload: e.payload.replace('"transfers":40', '"transfers":4000') })).toMatchObject({ ok: false, code: 'bad_signature' });
    const sig = Buffer.from(e.signature, 'base64'); sig[0] = sig[0]! ^ 1;
    expect(verify({ ...e, signature: sig.toString('base64') })).toMatchObject({ ok: false, code: 'bad_signature' });
    expect(verify({ ...e, signature: 'AAAA' })).toMatchObject({ ok: false, code: 'bad_signature' });
  });

  it('says nothing about the contents of a statement whose signature does not check', () => {
    const r = verify(envelope(body({ agentId: 'SECRET-LOOKING-VALUE' }), otherKey.privateKey));
    expect(JSON.stringify(r)).not.toContain('SECRET-LOOKING-VALUE');
  });

  it('refuses malformed envelopes and oversized ones', () => {
    for (const bad of [null, undefined, 'x', {}, { payload: 1, signature: 'x' }, { payload: '{}' }]) expect(verify(bad)).toMatchObject({ ok: false, code: 'malformed' });
    expect(verify(envelope('x'.repeat(20_000)))).toMatchObject({ ok: false, code: 'malformed' });
  });

  it('refuses a signed statement that is not in the expected form', () => {
    const cases: Array<unknown> = [
      '{not json', body({ version: 2 as 1 }), body({ issuer: 'someone-else' as 'forge-custody' }), body({ keyAddress: '0x123' }),
      body({ agentStatus: 'frozen' as 'active' }), body({}, { transfers: -1 }), body({}, { released: 1.5 }),
      body({}, { refused: 4 }),                                                                   // groups do not add up to the total
      body({}, { refusalsByReason: { 'over daily budget': 1, 'recipient not allowed': 2, extra: -1 } }),
      body({ issuedAt: 'yesterday' }),
    ];
    for (const c of cases) expect(verify(envelope(c)), JSON.stringify(c).slice(0, 80)).toMatchObject({ ok: false, code: 'invalid_payload' });
    expect(parsePayload(JSON.stringify(body()))).not.toBeNull();
  });

  it('refuses stale, future-dated and over-long statements', () => {
    expect(verify(envelope(body({ expiresAt: '2026-10-15T11:59:59.000Z' })))).toMatchObject({ ok: false, code: 'expired' });
    expect(verify(envelope(body({ issuedAt: '2026-10-15T13:00:00.000Z', expiresAt: '2026-10-16T13:00:00.000Z' })))).toMatchObject({ ok: false, code: 'not_yet_valid' });
    expect(verify(envelope(body({ issuedAt: '2026-10-15T11:00:00.000Z', expiresAt: '2026-11-15T11:00:00.000Z' })))).toMatchObject({ ok: false, code: 'validity_too_long' });
    expect(verify(envelope(body({ expiresAt: '2026-10-15T10:00:00.000Z' })))).toMatchObject({ ok: false });   // ends before it starts
  });

  it('refuses a statement about a wallet that is not this agent\'s, or when the agent has no proven wallet', () => {
    expect(verify(envelope(body({ keyAddress: OTHER_WALLET })))).toMatchObject({ ok: false, code: 'wallet_mismatch' });
    expect(verify(envelope(body()), { ...profile, evmAddress: undefined } as AgentCreditProfile)).toMatchObject({ ok: false, code: 'agent_has_no_evm_address' });
  });

  it('honours an audience binding to the bureau agent, by id or by DID', () => {
    expect(verify(envelope(body({ subject: 'agent_1' }))).ok).toBe(true);
    expect(verify(envelope(body({ subject: profile.did }))).ok).toBe(true);
    expect(verify(envelope(body({ subject: 'agent_someone_else' })))).toMatchObject({ ok: false, code: 'subject_mismatch' });
  });
});

describe('replacing a statement already held', () => {
  const prior = stored();
  it('accepts a newer one that only extends the record', () => {
    const next = body({ issuedAt: '2026-10-15T11:30:00.000Z', expiresAt: '2026-10-22T11:30:00.000Z' }, { transfers: 41, refused: 3 });
    expect(refuseIfRegressive(prior, next)).toBeNull();
    expect(refuseIfRegressive(undefined, next)).toBeNull();
  });
  it('refuses one that is not newer (a replay) and one whose lifetime counts went down', () => {
    expect(refuseIfRegressive(prior, body())).toMatchObject({ code: 'not_newer' });
    expect(refuseIfRegressive(prior, body({ issuedAt: '2026-10-14T00:00:00.000Z' }))).toMatchObject({ code: 'not_newer' });
    const newer = { issuedAt: '2026-10-15T11:30:00.000Z', expiresAt: '2026-10-22T11:30:00.000Z' };
    expect(refuseIfRegressive(prior, body(newer, { refused: 2, refusalsByReason: { 'recipient not allowed': 2 } }))).toMatchObject({ code: 'record_went_backwards' });
    expect(refuseIfRegressive(prior, body(newer, { released: 1 }))).toMatchObject({ code: 'record_went_backwards' });
  });
  it('refuses a swap to a different custody agent, customer or key without an explicit revoke', () => {
    const newer = { issuedAt: '2026-10-15T11:30:00.000Z', expiresAt: '2026-10-22T11:30:00.000Z' };
    for (const over of [{ agentId: 'cag_2' }, { custodyCustomerId: 'cust_2' }, { keyAddress: OTHER_WALLET }]) {
      expect(refuseIfRegressive(prior, body({ ...newer, ...over }))).toMatchObject({ code: 'different_custody_agent' });
    }
  });
});

describe('what Mode 2 takes from a statement', () => {
  it('measures success and budget compliance from the record', () => {
    const s = custodySignals(stored(), NOW, 10)!;
    expect(s.executed).toBe(42);
    expect(s.attempts).toBe(45);
    expect(s.successRateBps).toBe(9524);                    // 40 of 42 attempted payments went through
    expect(s.budgetComplianceRate).toBe(0.9778);            // 1 of 45 attempts was over budget
    expect(s).toMatchObject({ overBudgetRefusals: 1, otherRefusals: 2 });
  });

  it('counts only the two budget reasons against compliance, and a refusal is not a failed payment', () => {
    const a = stored({ record: { transfers: 20, released: 0, refused: 10, refusalsByReason: { 'over per-transfer limit': 4, 'over daily budget': 1, 'token not allowed': 5 } } });
    const s = custodySignals(a, NOW, 10)!;
    expect(s.successRateBps).toBe(10_000);                  // every attempted payment went through; refusals did not lower it
    expect(s.budgetComplianceRate).toBe(0.8333);            // 5 of 30 attempts over budget
  });

  it('leaves a rate unknown when there are too few attempts to say, rather than reporting a flattering 100%', () => {
    const thin = stored({ record: { transfers: 3, released: 0, refused: 0, refusalsByReason: {} } });
    expect(custodySignals(thin, NOW, 10)).toMatchObject({ successRateBps: null, budgetComplianceRate: null });
    const refusalsOnly = stored({ record: { transfers: 0, released: 0, refused: 12, refusalsByReason: { 'over daily budget': 12 } } });
    expect(custodySignals(refusalsOnly, NOW, 10)).toMatchObject({ successRateBps: null, budgetComplianceRate: 0 });
  });

  it('gives nothing once the statement has expired: an unknown is never assumed good', () => {
    expect(custodySignals(stored(), Date.parse('2026-10-23T00:00:00.000Z'), 10)).toBeNull();
  });
});

// ── Compatibility with the real issuer ──────────────────────────────────────

// fixtures/custody-attestation-sample.json is the actual output of AgentAttestationService.issue() in KHAYAAI/openfireblocks (the
// agent-attestation patch in docs/launch/custody-patches), signed with a throwaway key. The two sides were written separately; this
// is what shows they agree on the format.
describe('a statement produced by the custody issuer', () => {
  const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'custody-attestation-sample.json'), 'utf8')) as {
    envelope: { payload: string; signature: string }; publicKey: string; walletAddress: string; subject: string; verifyAt: string;
  };
  const env = { CUSTODY_ATTESTATION_PUBLIC_KEYS: fx.publicKey } as unknown as NodeJS.ProcessEnv;
  const at = Date.parse(fx.verifyAt);
  const prof = { agentId: fx.subject, did: `did:forge:${fx.walletAddress}`, evmAddress: fx.walletAddress.toLowerCase() } as AgentCreditProfile;

  it('verifies, binds to the agent\'s wallet and audience, and yields the expected signals', () => {
    const r = verifyAttestation(fx.envelope, prof, at, env);
    expect(r).toMatchObject({ ok: true, payload: { agentId: 'cag_fixture', record: { transfers: 40, released: 2, refused: 3 } } });
    if (!r.ok) return;
    const s = custodySignals({ ...r.payload, bureauAgentId: prof.agentId, submittedBy: 'op', receivedAt: fx.verifyAt }, at, 10)!;
    expect(s).toMatchObject({ attempts: 45, successRateBps: 9524, budgetComplianceRate: 0.9778 });
  });

  it('is refused for any other wallet, another audience, a different key, a late date or any change to the signed text', () => {
    expect(verifyAttestation(fx.envelope, { ...prof, evmAddress: OTHER_WALLET } as AgentCreditProfile, at, env)).toMatchObject({ code: 'wallet_mismatch' });
    expect(verifyAttestation(fx.envelope, { ...prof, agentId: 'someone_else', did: 'did:forge:agent_x' } as AgentCreditProfile, at, env)).toMatchObject({ code: 'subject_mismatch' });
    expect(verifyAttestation(fx.envelope, prof, at, { CUSTODY_ATTESTATION_PUBLIC_KEYS: otherKey.pub } as unknown as NodeJS.ProcessEnv)).toMatchObject({ code: 'bad_signature' });
    expect(verifyAttestation(fx.envelope, prof, Date.parse('2026-10-23T00:00:00.000Z'), env)).toMatchObject({ code: 'expired' });
    expect(verifyAttestation({ ...fx.envelope, payload: fx.envelope.payload.replace('"transfers":40', '"transfers":41') }, prof, at, env)).toMatchObject({ code: 'bad_signature' });
  });
});

// ── Through the real HTTP routes ────────────────────────────────────────────

const ADMIN = 'dev-bureau-admin-key';
const adminHeaders = { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' };
const authOnly = { authorization: `Bearer ${ADMIN}` };         // for requests with no body
const SAVED = { ...process.env };

describe('the routes', () => {
  let app: FastifyInstance;
  const REAL_WALLET = '0x' + '56'.repeat(20);
  const submit = (agentId: string, e: { payload: string; signature: string }, extra: Record<string, unknown> = { submittedBy: 'op@example.org' }, headers = adminHeaders) =>
    app.inject({ method: 'POST', url: `/v1/agents/${agentId}/custody-attestation`, headers, payload: JSON.stringify({ ...e, ...extra }) });
  const fresh = (over: Partial<AttestationPayload> = {}, rec: Partial<AttestationPayload['record']> = {}) =>
    envelope(body({ keyAddress: REAL_WALLET, issuedAt: new Date(Date.now() - 3_600_000).toISOString(), expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), ...over }, rec));

  beforeEach(async () => {
    delete process.env['STABLECOIN_GATEWAY_URL']; delete process.env['SETTLEMENT_PRIVATE_KEY'];
    process.env['CUSTODY_ATTESTATION_PUBLIC_KEYS'] = custodyKey.pub;
    delete process.env['ONCHAIN_INDEXER_ENABLED'];
    resetActivity(); setConfiguredChains([]);
    app = await buildApp(); await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/v1/agents/att_agent_1/profile', headers: adminHeaders,
      payload: JSON.stringify({ agentId: 'att_agent_1', did: `did:forge:${REAL_WALLET}`, operatorEntityId: 'op-1', operatorEntityType: 'llc' }),
    });
    expect([201, 409]).toContain(res.statusCode);          // 409: the profile store outlives each test's app, so it may already exist
  });
  afterEach(async () => { await app.close(); process.env = { ...SAVED }; resetActivity(); setConfiguredChains([]); resetAttestations(); });

  it('accepts a valid statement, returns a summary without the raw payload, and holds it', async () => {
    const res = await submit('att_agent_1', fresh());
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ agentId: 'att_agent_1', custodyAgentId: 'cag_1', submittedBy: 'op@example.org', expired: false, signals: { attempts: 45 } });
    expect(JSON.stringify(res.json())).not.toContain('signature');
    expect(getAttestation('att_agent_1')).toBeDefined();
    const got = await app.inject({ method: 'GET', url: '/v1/agents/att_agent_1/custody-attestation', headers: authOnly });
    expect(got.statusCode).toBe(200);
  });

  it('is admin-only: an institution key is refused, with or without scopes', async () => {
    const res = await submit('att_agent_1', fresh(), { submittedBy: 'x' }, { authorization: 'Bearer ck_aave_live_xxx', 'content-type': 'application/json' });
    expect([401, 403]).toContain(res.statusCode);
    expect(getAttestation('att_agent_1')).toBeUndefined();
    const anon = await app.inject({ method: 'POST', url: '/v1/agents/att_agent_1/custody-attestation', payload: '{}' });
    expect([401, 403]).toContain(anon.statusCode);
  });

  it('says when the feature is off, requires a consenting submitter, and refuses a forged or foreign statement', async () => {
    expect((await submit('att_agent_1', fresh(), {})).statusCode).toBe(400);
    expect((await submit('att_agent_1', fresh(), { submittedBy: 'x'.repeat(300) })).statusCode).toBe(400);
    expect((await submit('att_agent_1', envelope(body({ keyAddress: REAL_WALLET }), otherKey.privateKey))).json()).toMatchObject({ error: 'bad_signature' });
    expect((await submit('att_agent_1', fresh({ keyAddress: OTHER_WALLET }))).json()).toMatchObject({ error: 'wallet_mismatch' });
    expect((await submit('nope', fresh())).statusCode).toBe(404);
    expect(getAttestation('att_agent_1')).toBeUndefined();
    delete process.env['CUSTODY_ATTESTATION_PUBLIC_KEYS'];
    expect((await submit('att_agent_1', fresh())).statusCode).toBe(503);
  });

  it('refuses a replay of an older statement and one that lowers the lifetime counts, keeping the current one', async () => {
    const first = fresh({}, { transfers: 50 });
    expect((await submit('att_agent_1', first)).statusCode).toBe(201);
    expect((await submit('att_agent_1', first)).json()).toMatchObject({ error: 'not_newer' });
    const lower = fresh({ issuedAt: new Date(Date.now() - 60_000).toISOString() }, { transfers: 10 });
    expect((await submit('att_agent_1', lower)).json()).toMatchObject({ error: 'record_went_backwards' });
    expect(getAttestation('att_agent_1')!.record.transfers).toBe(50);
  });

  it('withdrawing consent erases the statement and its effect', async () => {
    await submit('att_agent_1', fresh());
    const del = await app.inject({ method: 'DELETE', url: '/v1/agents/att_agent_1/custody-attestation', headers: authOnly });
    expect(del.statusCode).toBe(204);
    expect(getAttestation('att_agent_1')).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/v1/agents/att_agent_1/custody-attestation', headers: authOnly })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/v1/agents/att_agent_1/custody-attestation', headers: authOnly })).statusCode).toBe(404);
  });

  describe('in the dual score', () => {
    const CFG: ChainConfig = { chainId: 8453, name: 'Base', rpcUrl: 'https://rpc.example.org', startBlock: 1, confirmations: 1, maxBlockRange: 10, tokens: [] };
    const indexed = () => hydrateActivity([{
      address: REAL_WALLET, chainId: 8453, cursor: 10, transferCount: 80, inboundCount: 40, outboundCount: 40, volumeCents: 9_000_000,
      counterparties: ['0x' + '01'.repeat(20), '0x' + '02'.repeat(20), '0x' + '03'.repeat(20), '0x' + '04'.repeat(20)],
      firstSeenBlock: 1, firstSeenAt: '2025-06-01T00:00:00.000Z', indexedAt: '2026-10-15T00:00:00.000Z', lastError: null,
    }]);
    const score = async () => (await app.inject({ method: 'GET', url: '/v1/agents/att_agent_1/dual-score', headers: authOnly })).json().data;
    const codes = (d: any) => (d.mode2.factors as Array<{ code: string }>).map((f) => f.code);

    beforeEach(() => { process.env['ONCHAIN_INDEXER_ENABLED'] = 'true'; setConfiguredChains([CFG]); indexed(); });

    it('adds the two measurements when a valid statement is held, and says it did', async () => {
      const before = await score();
      expect(codes(before)).toEqual(expect.arrayContaining(['SUCCESS_RATE_UNKNOWN', 'BUDGET_COMPLIANCE_UNMEASURED']));
      expect(before.custodySource).toBeUndefined();

      await submit('att_agent_1', fresh());
      const after = await score();
      expect(codes(after)).toEqual(expect.arrayContaining(['HIGH_SUCCESS_RATE', 'STRONG_BUDGET_COMPLIANCE']));
      expect(codes(after)).not.toContain('SUCCESS_RATE_UNKNOWN');
      expect(after.custodySource).toMatchObject({ issuer: 'forge-custody', used: true, attempts: 45, successRate: 'measured', budgetCompliance: 'measured' });

      await app.inject({ method: 'DELETE', url: '/v1/agents/att_agent_1/custody-attestation', headers: authOnly });
      expect(codes(await score())).toContain('SUCCESS_RATE_UNKNOWN');          // back to unknown once consent is withdrawn
    });

    it('a poor record lowers the factors honestly', async () => {
      await submit('att_agent_1', fresh({}, { transfers: 20, released: 20, refused: 20, refusalsByReason: { 'over daily budget': 20 } }));
      expect(codes(await score())).toEqual(expect.arrayContaining(['LOW_SUCCESS_RATE', 'POOR_BUDGET_COMPLIANCE']));
    });

    it('a thin record leaves the rates unknown, and an expired statement is reported as unused', async () => {
      await submit('att_agent_1', fresh({}, { transfers: 3, released: 0, refused: 0, refusalsByReason: {} }));
      const thin = await score();
      expect(codes(thin)).toContain('SUCCESS_RATE_UNKNOWN');
      expect(thin.custodySource).toMatchObject({ used: true, successRate: 'unknown', budgetCompliance: 'unknown' });

      const a = getAttestation('att_agent_1')!;
      hydrateAttestations([{ ...a, expiresAt: new Date(Date.now() - 1000).toISOString() }]);
      expect((await score()).custodySource).toMatchObject({ used: false, reason: 'expired' });
    });

    it('does not invent Mode 2 where there is no on-chain activity to score', async () => {
      resetActivity();
      await submit('att_agent_1', fresh());
      const d = await score();
      expect(d.mode2).toBeNull();
      expect(d.custodySource).toMatchObject({ used: false, reason: 'no_onchain_inputs' });
    });
  });
});

// ── Persistence ─────────────────────────────────────────────────────────────

const HAS_DB = Boolean(process.env['DATABASE_URL'] || process.env['DB_HOST']);
(HAS_DB ? describe : describe.skip)('against a real database', () => {
  type Store = typeof import('./store');
  type Db = typeof import('./db');
  let st: Store; let db: Db;
  beforeAll(async () => {
    st = await import('./store'); db = await import('./db');
    await st.initPersistence();
    await db.pool.query('TRUNCATE custody_attestations');
  });
  afterAll(async () => { setAttestationPersistence(null); await db.pool.query('TRUNCATE custody_attestations'); await db.pool.end(); });

  it('keeps a statement across a restart, and withdrawing consent deletes the row', async () => {
    await st.initPersistence();                                       // installs the write-through hook
    const a = stored({ bureauAgentId: 'persist_agent' });
    const { saveAttestation, revokeAttestation } = await import('./custody-attestation');
    saveAttestation(a);
    await new Promise((r) => setTimeout(r, 300));

    resetAttestations();                                              // the pod restarts: memory is gone
    expect(getAttestation('persist_agent')).toBeUndefined();
    await st.initPersistence();
    expect(getAttestation('persist_agent')).toMatchObject({ agentId: 'cag_1', submittedBy: 'op@example.org' });

    revokeAttestation('persist_agent');
    await new Promise((r) => setTimeout(r, 300));
    const rows = await db.pool.query(`SELECT 1 FROM custody_attestations WHERE agent_id = 'persist_agent'`);
    expect(rows.rowCount).toBe(0);                                    // erased from the database, not just from memory
    resetAttestations(); await st.initPersistence();
    expect(getAttestation('persist_agent')).toBeUndefined();
  });
});

/**
 * Per-signer cryptographic approval against a REAL Postgres (the real schema, the real CustodyService), with signers
 * holding their own keys. Runs only when CUSTODY_TEST_PG is set to a connection string that may create databases.
 */
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CustodyService } from './custody.service';
import { generateSignerKey, signMessage, voteMessage, enrollMessage, payloadDigest } from '../common/signer-sig';

const url = process.env.CUSTODY_TEST_PG;
const d = url ? describe : describe.skip;

d('signed votes (real Postgres)', () => {
  const DB = 'forgepay_custody_signed_test';
  const C = 'ws-1';
  let admin: Pool, pool: Pool, svc: any;
  const alice = generateSignerKey(), bob = generateSignerKey(), mallory = generateSignerKey();
  const pop = (k: ReturnType<typeof generateSignerKey>, email: string) => signMessage(k.privateKeyHex, enrollMessage(C, email, k.publicKeyHex));
  const vote = async (proposalId: string, kind: string, payload: any, email: string, key: ReturnType<typeof generateSignerKey>, approve = true, requestId: string | null = null) =>
    svc.vote(C, proposalId, email, approve, signMessage(key.privateKeyHex, voteMessage(C, proposalId, kind, payloadDigest(C, kind, requestId, payload), approve)));

  beforeAll(async () => {
    process.env.CUSTODY_REQUIRE_SIGNER_SIGNATURES = 'true';
    delete process.env.CUSTODY_PROPOSAL_SECRET; delete process.env.CUSTODY_ACTOR_SECRET;
    const base = new URL(url!);
    admin = new Pool({ connectionString: url });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`);
    base.pathname = '/' + DB;
    pool = new Pool({ connectionString: base.toString() });
    for (const f of ['init-db.sql', 'init-phase1.sql', 'init-custody.sql']) { // the order docker-compose applies them in
      await pool.query(readFileSync(join(__dirname, '../../../../infrastructure', f), 'utf8'));
    }
    svc = new CustodyService(
      pool as any, { getByCustomerId: async () => ({ customer_id: C }) } as any, {} as any,
      { logEvent: async () => undefined } as any, {} as any, { thresholdEnabled: false } as any, {} as any,
    );
  });
  afterAll(async () => { await pool?.end(); await admin?.query(`DROP DATABASE IF EXISTS ${DB}`); await admin?.end(); });

  it('a signer cannot be enrolled without a key and a valid proof of possession', async () => {
    await expect(svc.bootstrapSigner(C, 'alice@x.co', 'Alice')).rejects.toThrow(/enrol a public key/);
    await expect(svc.bootstrapSigner(C, 'alice@x.co', 'Alice', alice.publicKeyHex, pop(mallory, 'alice@x.co'))).rejects.toThrow(/not a valid signature/);
    await expect(svc.bootstrapSigner(C, 'alice@x.co', 'Alice', alice.publicKeyHex, pop(alice, 'someone-else@x.co'))).rejects.toThrow(/not a valid signature/);
    const s = await svc.bootstrapSigner(C, 'alice@x.co', 'Alice', alice.publicKeyHex, pop(alice, 'alice@x.co'));
    expect(s.public_key).toBe(alice.publicKeyHex);
  });

  it('a console (or anyone) cannot vote for a signer: unsigned, wrong-key and cross-decision signatures are all refused', async () => {
    const payload = { email: 'bob@x.co', name: 'Bob', publicKey: bob.publicKeyHex, pop: pop(bob, 'bob@x.co') };
    const p = await svc.propose(C, 'alice@x.co', 'add_signer', payload);
    expect(p.status).toBe('open');                 // proposing no longer counts as a vote when votes must be signed
    expect(p.votes).toHaveLength(0);
    expect(p.signing.required).toBe(true);
    await expect(svc.vote(C, p.id, 'alice@x.co', true)).rejects.toThrow(/signature/);
    await expect(vote(p.id, 'add_signer', payload, 'alice@x.co', mallory)).rejects.toThrow(/does not verify/);
    // a signature for REJECT cannot be turned into an approval
    const rejectSig = signMessage(alice.privateKeyHex, voteMessage(C, p.id, 'add_signer', payloadDigest(C, 'add_signer', null, payload), false));
    await expect(svc.vote(C, p.id, 'alice@x.co', true, rejectSig)).rejects.toThrow(/does not verify/);
    const done = await vote(p.id, 'add_signer', payload, 'alice@x.co', alice);
    expect(done.status).toBe('executed');
    expect((await pool.query(`SELECT public_key FROM custody.signers WHERE email='bob@x.co'`)).rows[0].public_key).toBe(bob.publicKeyHex);
  });

  it('a vote row written straight into the database counts for nothing', async () => {
    await pool.query(`UPDATE custody.signers SET active_from = NOW() WHERE customer_id=$1`, [C]);
    await pool.query(`UPDATE custody.settings SET threshold = 2 WHERE customer_id=$1`, [C]);
    const payload = { threshold: 1 };
    const p = await svc.propose(C, 'alice@x.co', 'set_threshold', payload);
    expect(p.required).toBe(2);
    const bobId = (await pool.query(`SELECT id FROM custody.signers WHERE email='bob@x.co'`)).rows[0].id;
    await pool.query(`INSERT INTO custody.votes (proposal_id, signer_id, approve) VALUES ($1,$2,true)`, [p.id, bobId]); // forged
    const after = await vote(p.id, 'set_threshold', payload, 'alice@x.co', alice);
    expect(after.status).toBe('open');              // alice's signed vote + bob's forged row = 1 verified approval, not 2
    const real = await vote(p.id, 'set_threshold', payload, 'bob@x.co', bob).catch((e: Error) => e);
    expect(String(real)).toMatch(/already voted/);  // bob's forged row occupies his slot; the proposal can never reach quorum on it
    expect((await pool.query(`SELECT status FROM custody.proposals WHERE id=$1`, [p.id])).rows[0].status).toBe('open');
  });

  it('altering a proposal after a signer signed it voids that signature', async () => {
    const payload = { threshold: 2 };
    const p = await svc.propose(C, 'alice@x.co', 'set_threshold', payload);
    await vote(p.id, 'set_threshold', payload, 'alice@x.co', alice);                       // alice approves threshold=2
    await pool.query(`UPDATE custody.proposals SET payload = '{"threshold": 1}' WHERE id=$1`, [p.id]); // attacker edits it
    const bobSig = signMessage(bob.privateKeyHex, voteMessage(C, p.id, 'set_threshold', payloadDigest(C, 'set_threshold', null, payload), true));
    await expect(svc.vote(C, p.id, 'bob@x.co', true, bobSig)).rejects.toThrow(/does not verify/); // bob signed the original
    const bobSigNew = signMessage(bob.privateKeyHex, voteMessage(C, p.id, 'set_threshold', payloadDigest(C, 'set_threshold', null, { threshold: 1 }), true));
    const r = await svc.vote(C, p.id, 'bob@x.co', true, bobSigNew);
    expect(r.status).toBe('open');                  // alice's signature no longer matches the edited payload: 1 of 2
    expect((await pool.query(`SELECT threshold FROM custody.settings WHERE customer_id=$1`, [C])).rows[0].threshold).toBe(2);
  });

  it('a signer without an enrolled key cannot vote, and a key is replaced only through a quorum proposal', async () => {
    await pool.query(`UPDATE custody.signers SET public_key = NULL WHERE email='bob@x.co'`);
    const payload = { threshold: 2 };
    const p = await svc.propose(C, 'alice@x.co', 'set_threshold', payload);
    await expect(vote(p.id, 'set_threshold', payload, 'bob@x.co', bob)).rejects.toThrow(/no signing key enrolled/);
    const newKey = generateSignerKey();
    const rotate = { email: 'bob@x.co', publicKey: newKey.publicKeyHex, pop: pop(newKey, 'bob@x.co') };
    await pool.query(`UPDATE custody.settings SET threshold = 1 WHERE customer_id=$1`, [C]);
    const sp = await svc.propose(C, 'alice@x.co', 'set_signer_key', rotate);
    await expect(svc.propose(C, 'alice@x.co', 'set_signer_key', { ...rotate, pop: pop(mallory, 'bob@x.co') })).rejects.toThrow(/not a valid signature/);
    const done = await vote(sp.id, 'set_signer_key', rotate, 'alice@x.co', alice);
    expect(done.status).toBe('executed');
    expect((await pool.query(`SELECT public_key FROM custody.signers WHERE email='bob@x.co'`)).rows[0].public_key).toBe(newKey.publicKeyHex);
  });
});

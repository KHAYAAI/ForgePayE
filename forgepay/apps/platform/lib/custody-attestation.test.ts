import { beforeEach, describe, expect, it, vi } from 'vitest';

const bureau = vi.hoisted(() => ({
  visible: new Set<string>(), calls: [] as Array<{ method: string; path: string; body?: any }>,
  reply: (() => ({ ok: true, status: 200, data: {} })) as (m: string, p: string, b?: any) => { ok: boolean; status: number; data: any; error?: unknown },
}));
vi.mock('./forge-services', () => ({
  bureauAgentVisibleTo: vi.fn(async (tenant: string, agent: string) => bureau.visible.has(`${tenant}:${agent}`)),
  bureauAdminCall: vi.fn(async (method: string, path: string, body?: any) => { bureau.calls.push({ method, path, body }); return bureau.reply(method, path, body); }),
}));

import { ACKNOWLEDGEMENT, getStatement, submitStatement, validateSubmitInput, withdrawStatement } from './custody-attestation';

const STATEMENT = { payload: '{"version":1}', signature: 'c2ln' };
const valid = (over: Record<string, unknown> = {}) => ({ agentId: 'agent_1', statement: STATEMENT, acknowledged: true, ...over });
const SUMMARY = { agentId: 'agent_1', custodyAgentId: 'cag_1', expiresInDays: 6, record: { transfers: 40, released: 0, refused: 0, refusalsByReason: {} }, signals: null };

beforeEach(() => {
  bureau.visible = new Set(['ws_a:agent_1']); bureau.calls.length = 0;
  bureau.reply = () => ({ ok: true, status: 200, data: SUMMARY });
});

describe('validating a submission', () => {
  it('needs the explicit acknowledgement, every time', () => {
    for (const ack of [undefined, false, 'true', 1, null]) {
      expect(validateSubmitInput(valid({ acknowledged: ack }))).toMatchObject({ ok: false, message: expect.stringMatching(/tick the acknowledgement/) });
    }
    expect(validateSubmitInput(valid()).ok).toBe(true);
  });

  it('accepts the statement as an object or as pasted JSON text, and ignores the informational public key', () => {
    const asObject = validateSubmitInput(valid());
    const asText = validateSubmitInput(valid({ statement: JSON.stringify({ ...STATEMENT, publicKey: 'ignored' }) }));
    for (const r of [asObject, asText]) expect(r).toMatchObject({ ok: true, value: { agentId: 'agent_1', payload: STATEMENT.payload, signature: STATEMENT.signature } });
    expect(JSON.stringify(asText)).not.toContain('ignored');
  });

  it('refuses a missing agent, non-JSON, a statement missing parts, an oversized one and a bad reference', () => {
    expect(validateSubmitInput(valid({ agentId: '' }))).toMatchObject({ ok: false });
    expect(validateSubmitInput(valid({ statement: 'not json' }))).toMatchObject({ ok: false, message: expect.stringMatching(/valid JSON/) });
    for (const bad of [{}, { payload: 'x' }, { signature: 'x' }, { payload: 1, signature: 'x' }, { payload: '', signature: 'x' }, null, []]) {
      expect(validateSubmitInput(valid({ statement: bad })).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(validateSubmitInput(valid({ statement: { payload: 'x'.repeat(30_000), signature: 'x' } }))).toMatchObject({ ok: false, message: expect.stringMatching(/too large/) });
    expect(validateSubmitInput(valid({ consentRef: 'x'.repeat(201) })).ok).toBe(false);
    expect(validateSubmitInput(null).ok).toBe(false);
  });

  it('shows the operator the wording they are agreeing to', () => {
    expect(ACKNOWLEDGEMENT).toMatch(/withdraw it at any time/);
  });
});

describe('submitting', () => {
  const input = () => { const v = validateSubmitInput(valid({ consentRef: 'ticket-9' })); if (!v.ok) throw new Error(); return v.value; };

  it('records the acting user as the submitter, whatever else the caller sent', async () => {
    const r = await submitStatement('ws_a', 'op@acme.test', input());
    expect(r.ok).toBe(true);
    expect(bureau.calls).toEqual([{
      method: 'POST', path: '/v1/agents/agent_1/custody-attestation',
      body: { payload: STATEMENT.payload, signature: STATEMENT.signature, submittedBy: 'op@acme.test', consentRef: 'ticket-9' },
    }]);
  });

  it('refuses an agent the workspace does not own before the bureau is asked anything', async () => {
    expect(await submitStatement('ws_other', 'x@y.test', input())).toMatchObject({ ok: false, status: 404 });
    expect(bureau.calls).toHaveLength(0);
  });

  it('passes the bureau\'s refusal on in plain words, for each reason', async () => {
    const cases: Array<[string, number, RegExp]> = [
      ['bad_signature', 422, /do not edit it/], ['wallet_mismatch', 422, /not this agent's wallet/], ['expired', 422, /fresh one/],
      ['not_newer', 409, /already holds/], ['record_went_backwards', 409, /cannot happen to a real record/], ['different_custody_agent', 409, /Withdraw the existing/],
      ['agent_has_no_evm_address', 422, /Connect its wallet/], ['unconfigured', 503, /not switched on/],
    ];
    for (const [code, status, pattern] of cases) {
      bureau.reply = () => ({ ok: false, status: code === 'unconfigured' ? 503 : status, data: null, error: { error: code } });
      const r = await submitStatement('ws_a', 'op@acme.test', input());
      expect(r, code).toMatchObject({ ok: false, status, error: code, message: expect.stringMatching(pattern) });
    }
  });

  it('says so when the bureau cannot be reached, and does not blame the statement', async () => {
    for (const reply of [{ ok: false, status: 0, data: null, error: 'ECONNREFUSED' }, { ok: false, status: 500, data: null, error: { error: 'Internal' } }]) {
      bureau.reply = () => reply;
      expect(await submitStatement('ws_a', 'op@acme.test', input())).toMatchObject({ ok: false, status: 502, error: 'BureauUnavailable' });
    }
  });
});

describe('viewing and withdrawing', () => {
  it('shows only a workspace\'s own agents, and treats "nothing held" as an answer, not an error', async () => {
    expect(await getStatement('ws_other', 'agent_1')).toMatchObject({ ok: false, status: 404 });
    expect(await getStatement('ws_a', 'agent_1')).toMatchObject({ ok: true, value: { custodyAgentId: 'cag_1' } });
    bureau.reply = () => ({ ok: false, status: 404, data: null, error: { error: 'NotFound' } });
    expect(await getStatement('ws_a', 'agent_1')).toEqual({ ok: true, value: null });
  });

  it('withdraws only its own agents\' statements, and says plainly if the bureau could not be reached', async () => {
    expect(await withdrawStatement('ws_other', 'agent_1')).toMatchObject({ ok: false, status: 404 });
    expect(bureau.calls).toHaveLength(0);
    bureau.reply = () => ({ ok: true, status: 204, data: null });
    expect(await withdrawStatement('ws_a', 'agent_1')).toEqual({ ok: true, value: { erased: true } });
    expect(bureau.calls[0]).toMatchObject({ method: 'DELETE', path: '/v1/agents/agent_1/custody-attestation' });
    bureau.reply = () => ({ ok: false, status: 404, data: null, error: { error: 'NotFound' } });
    expect(await withdrawStatement('ws_a', 'agent_1')).toEqual({ ok: true, value: { erased: false } });
    bureau.reply = () => ({ ok: false, status: 0, data: null, error: 'down' });
    expect(await withdrawStatement('ws_a', 'agent_1')).toMatchObject({ ok: false, status: 502, message: expect.stringMatching(/NOT withdrawn/) });
  });
});

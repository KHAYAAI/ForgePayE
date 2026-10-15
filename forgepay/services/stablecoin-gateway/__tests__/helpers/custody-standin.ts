/**
 * A stand-in for the FORGE custody agent API, for tests only.
 *
 * THIS IS NOT CUSTODY. It is a small in-process fake written from the controller and service source in KHAYAAI/openfireblocks
 * (services/api-gateway/src/agents/agents.controller.ts and agents.service.ts, commit pinned in config/base/pinned-upstreams.yaml).
 * It reproduces the behaviours the broadcaster depends on:
 *
 *   - Bearer agent-key auth (401 otherwise).
 *   - POST /agent/transfers: a refused attempt is recorded and answered 403 "agent refused: <reason>"; an accepted one reserves,
 *     then settles to 'spent' with a transaction hash. A repeat of a 'spent' request id is answered with the SAME payment
 *     (replayed: true) and never signs again; a repeat of a 'reserved' one is a 409. Recipients are stored lower-cased.
 *   - GET /agent/transfers/:id?chainId=: 404 when unknown, else the spend record plus an `onChain` block.
 *   - GET /agent/tokens and GET /agent/me.
 *
 * Because it is written from the source rather than from a running service, a test passing here shows the broadcaster follows that
 * contract. It does not show the real service behaves that way: that is what __tests__/custody-contract.test.ts is for.
 */

import { createHash } from 'node:crypto';
import type { FetchLike } from '../../src/lib/custody-payout-signer.js';

export interface StandInSpend {
  requestId: string; token: string; recipient: string; amountBaseUnits: string;
  status: 'reserved' | 'spent' | 'released' | 'refused'; reason: string | null; purpose: string | null; txHash: string | null;
}

export interface StandInToken { symbol: string; chainId: number; decimals: number; platformBroadcasts: boolean }

export const AGENT_KEY = 'ofb_agent_test_0123456789abcdef';

export const hashFor = (id: string) => '0x' + createHash('sha256').update(id).digest('hex');

export class StandInCustody {
  spends = new Map<string, StandInSpend>();
  /** Every request received, in order. */
  calls: Array<{ method: string; path: string; body: any; auth: string | undefined }> = [];
  /** How many times a payment was actually signed and broadcast. */
  payments = 0;

  tokens: StandInToken[] = [{ symbol: 'USDC', chainId: 84532, decimals: 6, platformBroadcasts: true }];
  agent = { agentId: 'agent_bureau', expiresAt: '2099-01-01T00:00:00.000Z', remaining24hZar: 1000 };

  /** Refuse the next payment(s) with this reason (403, recorded as 'refused'). */
  refuseWith: string | null = null;
  /** Faults on POST /agent/transfers, consumed one per request. */
  faults: Array<'network-before' | 'network-after' | '500-before'> = [];
  /** Chain behaviour for a spent payment: how many status reads before it confirms, and the final state. */
  confirmAfterReads = 1;
  finalChainState: 'confirmed' | 'reverted' = 'confirmed';
  confirmations = 3;
  /** Make the success reply disagree with what was asked (a misbehaving or compromised service). */
  lie: { recipient?: string; amount?: string; requestId?: string; omitBroadcast?: boolean } = {};
  /** A request id already reserved by another call, and how many status reads until it settles (Infinity = never). */
  inFlight = new Map<string, number>();

  private reads = new Map<string, number>();

  readonly fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const body = init.body ? JSON.parse(init.body) : undefined;
    const auth = init.headers['authorization'];
    this.calls.push({ method: init.method, path, body, auth });

    const reply = (status: number, json: unknown) => ({ status, text: async () => JSON.stringify(json) });
    if (auth !== `Bearer ${AGENT_KEY}`) return reply(401, { statusCode: 401, message: 'invalid, revoked or expired agent key' });

    if (init.method === 'GET' && u.pathname === '/agent/me') return reply(200, { ...this.agent, name: 'bureau', allowedTokens: ['USDC'] });
    if (init.method === 'GET' && u.pathname === '/agent/tokens') return reply(200, { tokens: this.tokens });

    const m = /^\/agent\/transfers\/([^/]+)$/.exec(u.pathname);
    if (init.method === 'GET' && m) return this.status(decodeURIComponent(m[1]!), Number(u.searchParams.get('chainId')), reply);

    if (init.method === 'POST' && u.pathname === '/agent/transfers') {
      const fault = this.faults.shift();
      if (fault === 'network-before') throw new Error('fetch failed');
      if (fault === '500-before') return reply(500, { statusCode: 500, message: 'Internal server error' });
      const out = this.pay(body, reply);
      if (fault === 'network-after') throw new Error('fetch failed');
      return out;
    }
    return reply(404, { statusCode: 404, message: 'not found' });
  };

  private pay(dto: any, reply: (s: number, j: unknown) => { status: number; text(): Promise<string> }) {
    const id: string = dto.idempotencyKey;
    const prior = this.spends.get(id);
    if (prior?.status === 'spent') {
      return reply(200, { replayed: true, broadcast: true, request_id: id, transaction_hash: prior.txHash, token: { symbol: prior.token }, recipient: prior.recipient, amount_base_units: prior.amountBaseUnits });
    }
    if (prior?.status === 'reserved' || this.inFlight.has(id)) {
      return reply(409, { statusCode: 409, message: `payment ${id} is still being signed; check it with GET /agent/transfers/${id}` });
    }
    const record: StandInSpend = {
      requestId: id, token: String(dto.token).toUpperCase(), recipient: String(dto.recipient).toLowerCase(),
      amountBaseUnits: toUnits(dto.amount, this.tokens.find((t) => t.symbol === String(dto.token).toUpperCase())?.decimals ?? 6),
      status: 'reserved', reason: null, purpose: dto.purpose ?? null, txHash: null,
    };
    const token = this.tokens.find((t) => t.symbol === record.token && t.chainId === dto.chainId);
    const refusal = !token ? `token not allowed: ${dto.token}` : this.refuseWith;
    if (refusal) {
      this.spends.set(id, { ...record, status: 'refused', reason: refusal });
      return reply(403, { statusCode: 403, message: `agent refused: ${refusal}` });
    }
    this.spends.set(id, { ...record, status: 'spent', txHash: hashFor(id) });
    this.payments += 1;
    return reply(200, {
      ...(this.lie.omitBroadcast ? {} : { broadcast: true }),
      request_id: this.lie.requestId ?? id,
      transaction_hash: hashFor(id),
      token: { symbol: record.token },
      recipient: this.lie.recipient ?? record.recipient,
      amount_base_units: this.lie.amount ?? record.amountBaseUnits,
    });
  }

  private status(id: string, chainId: number, reply: (s: number, j: unknown) => { status: number; text(): Promise<string> }) {
    if (this.inFlight.has(id)) {
      const left = this.inFlight.get(id)!;
      if (left <= 0) {
        this.inFlight.delete(id);
        this.spends.set(id, { requestId: id, token: 'USDC', recipient: '0x' + 'ab'.repeat(20), amountBaseUnits: '1500000', status: 'spent', reason: null, purpose: null, txHash: hashFor(id) });
        this.payments += 1;
      } else {
        this.inFlight.set(id, left - 1);
        return reply(200, { requestId: id, status: 'reserved', txHash: null, onChain: null });
      }
    }
    const s = this.spends.get(id);
    if (!s) return reply(404, { statusCode: 404, message: `no payment ${id} for this agent` });
    if (!s.txHash) return reply(200, { ...s, onChain: null });
    const n = (this.reads.get(id) ?? 0) + 1;
    this.reads.set(id, n);
    const settled = n > this.confirmAfterReads;
    return reply(200, {
      ...s,
      onChain: !chainId ? null : settled
        ? { chainId, state: this.finalChainState, blockNumber: 123, confirmations: this.confirmations }
        : { chainId, state: 'pending', blockNumber: null, confirmations: 0 },
    });
  }
}

function toUnits(amount: string, decimals: number): string {
  const [whole, frac = ''] = String(amount).split('.');
  return (BigInt(whole! + frac.padEnd(decimals, '0').slice(0, decimals))).toString();
}

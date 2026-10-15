/**
 * The outbound signer backed by FORGE custody.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What this replaces, and why
 *
 * `payout-signer.ts` pays from a hot wallet whose private key sits in this service's environment or a mounted file. That key is the
 * most dangerous secret the service holds. This broadcaster holds no key at all. It asks FORGE custody to make the payment, using
 * an *agent key* (`ofb_agent_…`) that an organisation admin issued with fixed limits, and custody does the rest: the token registry,
 * its policy engine, the Travel Rule, a 2-of-3 threshold signature by independent signing parties, and the broadcast.
 *
 *   POST /agent/transfers                      pay (the payout's id is the idempotency key)
 *   GET  /agent/transfers/:id?chainId=         what custody recorded, and what the chain says
 *   GET  /agent/tokens, GET /agent/me          which tokens the key may pay in, and its limits
 *
 * Contract source: services/api-gateway/src/agents/ in KHAYAAI/openfireblocks (commit pinned in config/base/pinned-upstreams.yaml).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Rules this file keeps
 *
 *   - OFF unless PAYOUT_SIGNER_ENABLED=true and PAYOUT_SIGNER_MODE=custody. Anything else leaves the existing behaviour untouched.
 *   - A hot key may not coexist with it. Custody mode exists to remove that key; if one is also configured, startup refuses.
 *   - It never retries a payment blind. The payout id is the idempotency key, so asking again returns the same payment and can
 *     never pay twice. When an answer is ambiguous (timeout, 5xx, 409) it asks custody what it recorded and acts on that.
 *   - It re-checks our own ceilings at the moment money moves, in addition to custody's limits. Two independent limits, held by
 *     two different parties, are the point.
 *   - It does not trust a success response: the recipient, amount and request id in it must match what we asked for.
 *   - The agent key is never logged, echoed in an error, or returned by any route.
 */

import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { isProductionLike } from './env.js';
import {
  setPayoutBroadcaster, PAYOUT_ABSOLUTE_MAX_USD, PayoutPendingError,
  type Payout, type PayoutBroadcaster, type BroadcastResult, type BroadcastHooks, type ChainOutcome,
} from './payouts.js';
import {
  installPayoutSigner, PayoutSignerConfigError, spentLast24hUsd, USDC_BY_CHAIN, type InstallResult,
} from './payout-signer.js';

// Imported lazily for the same reason as in payout-signer.ts: config.ts throws on missing service secrets, and the preflight
// must be able to say "not configured" without them.
async function log() {
  const { logger } = await import('./logger.js');
  return logger;
}

// ── Configuration ────────────────────────────────────────────────────────────

export class CustodyConfigError extends PayoutSignerConfigError {
  constructor(message: string) { super(message); this.name = 'CustodyConfigError'; }
}

export interface CustodyConfig {
  /** Origin of the custody API gateway, no trailing slash. */
  baseUrl: string;
  chain: string;
  chainId: number;
  /** Our own rolling 24-hour ceiling, independent of the limits custody holds on the agent key. */
  dailyMaxUsd: number;
  /**
   * Refuse an agent key that has no recipient list. On by default in production: with a fixed list a stolen key cannot pay
   * anyone else, and changing where money goes then needs a person (a new key). Off only by explicit CUSTODY_ALLOW_OPEN_RECIPIENTS=true.
   */
  requireRecipientList: boolean;
  confirmations: number;
  /** How long one HTTP call may take. Signing a threshold transaction takes seconds, not milliseconds. */
  requestTimeoutMs: number;
  /** How long to wait for a sent payment to confirm before leaving it pending for the worker. */
  waitMs: number;
  /** How long to wait for an ambiguous or in-flight payment to resolve at custody. */
  resolveMs: number;
  pollMs: number;
}

export function custodyModeRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['PAYOUT_SIGNER_ENABLED'] === 'true' && env['PAYOUT_SIGNER_MODE'] === 'custody';
}

const positiveInt = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new CustodyConfigError(`${name} must be a positive whole number.`);
  return n;
};

/** Resolve the configuration, or say precisely what is missing. Every failure is a refusal to pay; none falls back to a default. */
export function resolveCustodyConfig(env: NodeJS.ProcessEnv = process.env): CustodyConfig {
  if (env['PAYOUT_SIGNER_PRIVATE_KEY'] || env['PAYOUT_SIGNER_KEY_FILE']) {
    throw new CustodyConfigError(
      'PAYOUT_SIGNER_MODE=custody but a hot-wallet key is also configured (PAYOUT_SIGNER_PRIVATE_KEY or PAYOUT_SIGNER_KEY_FILE). ' +
      'Custody mode exists so that this service holds no key; remove the hot key rather than run both.',
    );
  }

  const rawUrl = env['CUSTODY_API_URL'];
  if (!rawUrl) throw new CustodyConfigError('CUSTODY_API_URL is not set.');
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new CustodyConfigError('CUSTODY_API_URL is not a valid URL.'); }
  if (url.username || url.password) throw new CustodyConfigError('CUSTODY_API_URL must not contain credentials.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !isProductionLike(env))) {
    throw new CustodyConfigError('CUSTODY_API_URL must be https (plain http is accepted only outside production).');
  }

  const chain = env['PAYOUT_SIGNER_CHAIN'];
  if (!chain) throw new CustodyConfigError('PAYOUT_SIGNER_CHAIN is not set. Supported: ' + Object.keys(USDC_BY_CHAIN).join(', '));
  const known = USDC_BY_CHAIN[chain];
  if (!known) throw new CustodyConfigError(`PAYOUT_SIGNER_CHAIN="${chain}" is not a supported chain. Supported: ${Object.keys(USDC_BY_CHAIN).join(', ')}`);

  const dailyRaw = env['PAYOUT_SIGNER_DAILY_MAX_USD'];
  if (!dailyRaw) {
    throw new CustodyConfigError('PAYOUT_SIGNER_DAILY_MAX_USD is not set. Set our own daily ceiling deliberately; it is a second limit beside the one custody holds.');
  }
  const dailyMaxUsd = Number(dailyRaw);
  if (!Number.isFinite(dailyMaxUsd) || dailyMaxUsd <= 0) throw new CustodyConfigError('PAYOUT_SIGNER_DAILY_MAX_USD must be a positive number.');

  let chainId = known.chainId;
  const override = env['PAYOUT_SIGNER_CHAIN_ID'];
  if (override) {
    if (isProductionLike(env)) throw new CustodyConfigError('PAYOUT_SIGNER_CHAIN_ID may not be set in production.');
    chainId = Number(override);
    if (!Number.isInteger(chainId) || chainId <= 0) throw new CustodyConfigError('PAYOUT_SIGNER_CHAIN_ID must be a positive integer.');
  }

  return {
    baseUrl: url.origin + url.pathname.replace(/\/+$/, ''),
    chain, chainId, dailyMaxUsd,
    requireRecipientList: isProductionLike(env) && env['CUSTODY_ALLOW_OPEN_RECIPIENTS'] !== 'true',
    confirmations: Math.max(1, positiveInt(env['PAYOUT_SIGNER_CONFIRMATIONS'], 1, 'PAYOUT_SIGNER_CONFIRMATIONS')),
    requestTimeoutMs: positiveInt(env['CUSTODY_REQUEST_TIMEOUT_MS'], 60_000, 'CUSTODY_REQUEST_TIMEOUT_MS'),
    waitMs: positiveInt(env['PAYOUT_SIGNER_WAIT_MS'], 180_000, 'PAYOUT_SIGNER_WAIT_MS'),
    resolveMs: positiveInt(env['CUSTODY_RESOLVE_MS'], 60_000, 'CUSTODY_RESOLVE_MS'),
    pollMs: positiveInt(env['CUSTODY_POLL_MS'], 3_000, 'CUSTODY_POLL_MS'),
  };
}

/** The agent key: a mounted file is preferred, as for any secret. Never printed, never echoed in an error. */
export function readAgentKey(env: NodeJS.ProcessEnv = process.env): string {
  let key: string | undefined;
  const path = env['CUSTODY_AGENT_KEY_FILE'];
  if (path) {
    try { key = readFileSync(path, 'utf8').trim(); }
    catch (err) {
      throw new CustodyConfigError(`CUSTODY_AGENT_KEY_FILE is set to ${path} but could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (env['CUSTODY_AGENT_KEY']) {
    key = env['CUSTODY_AGENT_KEY'].trim();
  }
  if (!key) throw new CustodyConfigError('No custody agent key is configured. Set CUSTODY_AGENT_KEY_FILE (preferred, a mounted secret) or CUSTODY_AGENT_KEY.');
  if (!/^ofb_agent_\S+$/.test(key)) {
    throw new CustodyConfigError('The configured custody agent key is not an agent key (it must start with ofb_agent_). Details withheld so the key cannot reach the logs.');
  }
  return key;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{
  status: number; text(): Promise<string>;
}>;

export interface CustodyDeps {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** The call could not be completed (network error or timeout). For a payment this is an ambiguous outcome, not a failure. */
export class CustodyUnreachableError extends Error {
  constructor(message: string) { super(message); this.name = 'CustodyUnreachableError'; }
}

interface CustodyReply { status: number; json: any }

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n) + '…' : s);

function replyMessage(r: CustodyReply): string {
  const m = r.json?.message ?? r.json?.error;
  return clip(Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : `HTTP ${r.status}`);
}

// ── The broadcaster ──────────────────────────────────────────────────────────

export class CustodyPayoutBroadcaster implements PayoutBroadcaster {
  readonly name = 'custody';
  private readonly doFetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly cfg: CustodyConfig, private readonly agentKey: string, deps: CustodyDeps = {}) {
    this.doFetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<CustodyReply> {
    let res;
    try {
      res = await this.doFetch(this.cfg.baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${this.agentKey}`, 'content-type': 'application/json', accept: 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
      });
    } catch (err) {
      // The message of a fetch failure can name the URL; the URL carries no secret, the key is in a header. Still, keep it short.
      throw new CustodyUnreachableError(`custody unreachable: ${clip((err as Error).name === 'TimeoutError' ? 'timed out' : String((err as Error).message ?? err), 120)}`);
    }
    const text = await res.text().catch(() => '');
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { message: clip(text, 200) }; }
    return { status: res.status, json };
  }

  private statusPath(payout: Payout): string {
    return `/agent/transfers/${encodeURIComponent(payout.id)}?chainId=${this.cfg.chainId}`;
  }

  /**
   * The key must be alive, and the recipient must be on its list. Refused here, before asking, so that a refusal we could predict is
   * not recorded in custody as a refused attempt: those records are part of an agent's track record and should reflect real misbehaviour.
   */
  private async checkAgent(payout: Payout): Promise<void> {
    const me = await this.call('GET', '/agent/me');
    if (me.status === 401) throw new Error('Custody rejected the agent key (invalid, revoked or expired). Refusing to send.');
    if (me.status !== 200) throw new Error(`Could not read the custody agent key's limits (${replyMessage(me)}). Refusing to send.`);
    // Wall-clock time, not the injectable timer used for poll deadlines.
    if (me.json?.expiresAt && Date.parse(me.json.expiresAt) <= Date.now()) throw new Error('The custody agent key has expired. Refusing to send.');
    const list: unknown = me.json?.allowedRecipients;
    if (Array.isArray(list)) {
      if (!list.map((r) => String(r).toLowerCase()).includes(payout.payeeAddress.toLowerCase())) {
        throw new Error(
          `Recipient ${payout.payeeAddress} is not on the custody agent key's recipient list, so payout ${payout.id} was not attempted. ` +
          'A custody admin must issue a new key that includes this address (and the old key should then be revoked).',
        );
      }
    } else if (this.cfg.requireRecipientList) {
      throw new Error(
        'The custody agent key has no recipient list, so it could pay any address. Refusing in production: ask a custody admin for a key with a fixed ' +
        'list of furnisher payout addresses (set CUSTODY_ALLOW_OPEN_RECIPIENTS=true only if you accept that risk deliberately).',
      );
    }
  }

  /** The token must be one this key may pay in, verified, on our chain, with the decimals this payout was priced with. */
  private async checkToken(payout: Payout): Promise<void> {
    const r = await this.call('GET', '/agent/tokens');
    if (r.status === 401) throw new Error('Custody rejected the agent key (invalid, revoked or expired). Refusing to send.');
    if (r.status !== 200) throw new Error(`Could not read the custody token list (${replyMessage(r)}). Refusing to send.`);
    const list: Array<{ symbol: string; chainId: number; decimals: number; platformBroadcasts?: boolean }> = r.json?.tokens ?? [];
    const t = list.find((x) => x.symbol.toUpperCase() === payout.asset.toUpperCase() && x.chainId === this.cfg.chainId);
    if (!t) throw new Error(`${payout.asset} is not a token this custody agent key may pay in on ${this.cfg.chain} (chain ${this.cfg.chainId}).`);
    if (t.decimals !== payout.decimals) {
      throw new Error(`Payout ${payout.id} was priced with ${payout.decimals} decimals but custody lists ${payout.asset} with ${t.decimals}. Refusing: the amount would be wrong by a power of ten.`);
    }
    if (t.platformBroadcasts === false) {
      throw new Error(`Custody has no RPC endpoint for chain ${this.cfg.chainId}, so it cannot broadcast ${payout.asset}. Refusing to send.`);
    }
  }

  async canCover(payout: Payout): Promise<{ ok: boolean; reason?: string }> {
    // The agent key cannot see the custody wallet's balance, so this checks what it can: that the key works and may pay this token.
    // A balance shortfall surfaces as a refusal when the payment is attempted, and the payout fails visibly.
    try {
      const me = await this.call('GET', '/agent/me');
      if (me.status === 401) return { ok: false, reason: 'custody rejected the agent key' };
      if (me.status !== 200) return { ok: false, reason: `custody not ready (${replyMessage(me)})` };
      // Wall-clock time, not the injectable timer used for poll deadlines.
      if (me.json?.expiresAt && Date.parse(me.json.expiresAt) <= Date.now()) return { ok: false, reason: 'the custody agent key has expired' };
      await this.checkToken(payout);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof CustodyUnreachableError ? 'custody unreachable' : clip(String((err as Error).message), 200) };
    }
  }

  async reconcile(payout: Payout): Promise<ChainOutcome> {
    if (!payout.txHash) return 'pending';
    try {
      const r = await this.call('GET', this.statusPath(payout));
      if (r.status !== 200) return 'pending';          // unknown to us is not failed: never invite a second payment on a guess
      if (r.json?.onChain?.state === 'confirmed') return 'confirmed';
      if (r.json?.onChain?.state === 'reverted') return 'failed';
      return 'pending';
    } catch {
      return 'pending';
    }
  }

  async broadcast(payout: Payout, hooks?: BroadcastHooks): Promise<BroadcastResult> {
    const cfg = this.cfg;

    // ── Our own checks, at the moment money moves. None adjusts the payout to make it fit.
    if (payout.chain !== cfg.chain) {
      throw new Error(`Payout ${payout.id} is for chain "${payout.chain}" but custody payouts are configured for "${cfg.chain}". Refusing to send on the wrong chain.`);
    }
    if (payout.amountUsdc > PAYOUT_ABSOLUTE_MAX_USD) {
      throw new Error(`Payout ${payout.id} is $${payout.amountUsdc}, above the absolute ceiling of $${PAYOUT_ABSOLUTE_MAX_USD}.`);
    }
    const spent = await spentLast24hUsd();
    if (spent + payout.amountUsdc > cfg.dailyMaxUsd) {
      throw new Error(
        `Payout ${payout.id} would take the trailing-24h total to $${(spent + payout.amountUsdc).toFixed(2)}, above the daily ceiling of ` +
        `$${cfg.dailyMaxUsd}. Refusing. Raise PAYOUT_SIGNER_DAILY_MAX_USD deliberately if this volume is expected.`,
      );
    }
    if (!ADDRESS.test(payout.payeeAddress)) throw new Error(`Payout ${payout.id} has no valid recipient address.`);
    let units: bigint;
    try { units = BigInt(payout.amountUnits); } catch { throw new Error(`Payout ${payout.id} has an unreadable amount.`); }
    if (units <= 0n) throw new Error(`Payout ${payout.id} has no amount to send.`);

    await this.checkAgent(payout);
    await this.checkToken(payout);

    // ── Ask custody to pay. One request, keyed by the payout id: asking again can only return this same payment.
    (await log()).info(
      { payoutId: payout.id, chain: cfg.chain, asset: payout.asset, amountUnits: payout.amountUnits, amountUsdc: payout.amountUsdc, to: payout.payeeAddress },
      '[custody-signer] requesting payment from custody',
    );
    let reply: CustodyReply | undefined;
    try {
      reply = await this.call('POST', '/agent/transfers', {
        token: payout.asset,
        recipient: payout.payeeAddress,
        amount: ethers.formatUnits(units, payout.decimals),
        chainId: cfg.chainId,
        purpose: `bureau payout ${payout.id}`.slice(0, 500),
        idempotencyKey: payout.id,
      });
    } catch (err) {
      if (!(err instanceof CustodyUnreachableError)) throw err;
      // The request may or may not have reached custody. Ask what it recorded.
      return this.resolve(payout, hooks, err.message);
    }

    if (reply.status >= 200 && reply.status < 300) return this.accept(payout, hooks, reply.json);
    if (reply.status === 409 || reply.status === 408 || reply.status >= 500) {
      return this.resolve(payout, hooks, `custody answered ${reply.status}: ${replyMessage(reply)}`);
    }
    // 4xx: custody refused (policy, limits, recipient or token not allowed, bad key). Nothing was paid.
    throw new Error(`Custody refused payout ${payout.id}: ${replyMessage(reply)}`);
  }

  /** A 2xx reply. Trust nothing in it that we can check. */
  private async accept(payout: Payout, hooks: BroadcastHooks | undefined, json: any): Promise<BroadcastResult> {
    const hash = json?.transaction_hash;
    if (json?.broadcast !== true || typeof hash !== 'string' || !HASH.test(hash)) {
      throw new Error(`Custody accepted payout ${payout.id} but did not report a broadcast transaction. Reconcile with custody (request id ${payout.id}) before re-issuing.`);
    }
    // Recorded before anything else is judged: from here on a crash, or a mismatch, leaves a hash to reconcile against.
    await hooks?.onSent?.(hash);
    const mismatches: string[] = [];
    if (json.request_id !== undefined && json.request_id !== payout.id) mismatches.push('request id');
    if (typeof json.recipient === 'string' && json.recipient.toLowerCase() !== payout.payeeAddress.toLowerCase()) mismatches.push('recipient');
    if (json.amount_base_units !== undefined && String(json.amount_base_units) !== payout.amountUnits) mismatches.push('amount');
    if (mismatches.length > 0) {
      throw new Error(
        `Custody reported a different ${mismatches.join(' and ')} than payout ${payout.id} asked for (tx ${hash}). ` +
        'Do not re-issue. Investigate the transaction before anything else.',
      );
    }
    await this.awaitConfirmation(payout, hash);
    (await log()).info({ payoutId: payout.id, txHash: hash }, '[custody-signer] payout confirmed on-chain');
    return { txHash: hash };
  }

  /**
   * The outcome of the request is unknown (no answer, a server error, or a payment already in flight). Custody keeps a record per
   * request id from the moment it reserves budget, so asking by the payout id tells us the truth.
   */
  private async resolve(payout: Payout, hooks: BroadcastHooks | undefined, why: string): Promise<BroadcastResult> {
    const deadline = this.now() + this.cfg.resolveMs;
    let last = '';
    for (;;) {
      try {
        const r = await this.call('GET', this.statusPath(payout));
        if (r.status === 404) {
          throw new Error(`Payout ${payout.id} was not paid: ${why}, and custody has no record of the request.`);
        }
        if (r.status === 200) {
          const s = r.json;
          if (s?.status === 'spent' && typeof s.txHash === 'string' && HASH.test(s.txHash)) {
            return this.accept(payout, hooks, {
              broadcast: true, transaction_hash: s.txHash, request_id: s.requestId, recipient: s.recipient, amount_base_units: s.amountBaseUnits,
            });
          }
          if (s?.status === 'refused' || s?.status === 'released') {
            throw new Error(`Payout ${payout.id} was not paid: custody recorded it as ${s.status}${s.reason ? ` (${clip(String(s.reason), 200)})` : ''}.`);
          }
          last = `custody records it as ${s?.status ?? 'unknown'}`;   // 'reserved': still being signed
        } else if (r.status === 401) {
          throw new Error('Custody rejected the agent key while checking a payment. Reconcile with custody before re-issuing.');
        } else {
          last = `custody answered ${r.status} when asked`;
        }
      } catch (err) {
        if (!(err instanceof CustodyUnreachableError)) throw err;
        last = err.message;
      }
      if (this.now() >= deadline) break;
      await this.sleep(this.cfg.pollMs);
    }
    // Unresolved. There is no hash to reconcile against, so this fails the payout loudly and says not to re-issue it.
    throw new Error(
      `Payout ${payout.id} is unresolved: ${why}; ${last}. It may still complete at custody. Do not re-issue it; ` +
      `check custody for request id ${payout.id}.`,
    );
  }

  private async awaitConfirmation(payout: Payout, txHash: string): Promise<void> {
    const deadline = this.now() + this.cfg.waitMs;
    for (;;) {
      try {
        const r = await this.call('GET', this.statusPath(payout));
        const chain = r.json?.onChain;
        if (r.status === 200 && chain?.state === 'reverted') {
          throw new Error(`${payout.asset} transfer for payout ${payout.id} reverted on-chain (tx ${txHash}). Reconcile before re-issuing.`);
        }
        if (r.status === 200 && chain?.state === 'confirmed' && Number(chain.confirmations ?? 0) >= this.cfg.confirmations) return;
      } catch (err) {
        if (!(err instanceof CustodyUnreachableError)) throw err;   // a blip while waiting is not a result: keep waiting
      }
      if (this.now() >= deadline) {
        throw new PayoutPendingError(txHash, `${payout.asset} transfer for payout ${payout.id} was sent (tx ${txHash}) but not confirmed within ${this.cfg.waitMs}ms`);
      }
      await this.sleep(this.cfg.pollMs);
    }
  }
}

// ── Readiness (read-only) ────────────────────────────────────────────────────

export interface CustodyReadiness { ok: boolean; info: string[]; problems: string[] }

/**
 * Everything worth knowing before turning custody payouts on, learned without paying anything: the key works, when it expires, what
 * it may pay in on our chain, and whether custody can broadcast there. Used by the preflight CLI; safe to run against any environment.
 */
export async function checkCustodyReadiness(
  cfg: CustodyConfig, agentKey: string, asset = 'USDC', deps: CustodyDeps = {},
): Promise<CustodyReadiness> {
  const b = new CustodyPayoutBroadcaster(cfg, agentKey, deps);
  const info: string[] = []; const problems: string[] = [];
  try {
    const me = await b['call']('GET', '/agent/me');
    if (me.status === 401) problems.push('Custody rejected the agent key (invalid, revoked or expired).');
    else if (me.status !== 200) problems.push(`Custody could not describe this agent key (${replyMessage(me)}).`);
    else {
      info.push(`Agent           : ${me.json.name ?? me.json.agentId} (${me.json.agentId})`);
      const left = me.json.expiresAt ? Date.parse(me.json.expiresAt) - Date.now() : NaN;
      info.push(`Key expires     : ${me.json.expiresAt ?? 'unknown'}`);
      if (Number.isFinite(left) && left <= 0) problems.push('The agent key has expired.');
      else if (Number.isFinite(left) && left < 7 * 86_400_000) problems.push('The agent key expires within 7 days; issue a new one before it does.');
      const recipients: unknown = me.json.allowedRecipients;
      if (Array.isArray(recipients)) info.push(`Recipients      : fixed list of ${recipients.length} address${recipients.length === 1 ? '' : 'es'}`);
      else {
        info.push('Recipients      : OPEN (the key could pay any address)');
        if (cfg.requireRecipientList) problems.push('The agent key has no recipient list. In production the signer refuses such a key; ask a custody admin for one with a fixed list.');
      }
      info.push(`Custody limits  : R${me.json.perTransferLimitZar ?? '?'} per payment, R${me.json.dailyLimitZar ?? '?'} per 24h, R${me.json.remaining24hZar ?? '?'} left now (rand, set by the custody admin)`);
    }
    const tk = await b['call']('GET', '/agent/tokens');
    if (tk.status === 200) {
      const list: Array<{ symbol: string; chainId: number; decimals: number; platformBroadcasts?: boolean }> = tk.json?.tokens ?? [];
      const t = list.find((x) => x.symbol.toUpperCase() === asset.toUpperCase() && x.chainId === cfg.chainId);
      if (!t) problems.push(`${asset} is not a token this agent key may pay in on chain ${cfg.chainId}. It may pay in: ${list.map((x) => `${x.symbol}@${x.chainId}`).join(', ') || 'nothing'}.`);
      else {
        info.push(`${asset} on ${cfg.chain}${' '.repeat(Math.max(1, 10 - cfg.chain.length))}: chain ${t.chainId}, ${t.decimals} decimals`);
        if (t.platformBroadcasts === false) problems.push(`Custody has no RPC endpoint for chain ${cfg.chainId}, so it cannot broadcast.`);
      }
    } else if (tk.status !== 401) problems.push(`Custody could not list the tokens (${replyMessage(tk)}).`);
  } catch (err) {
    problems.push(err instanceof CustodyUnreachableError ? `Could not reach custody at ${cfg.baseUrl}: ${err.message}.` : String((err as Error).message));
  }
  info.push(`Our own ceiling : $${cfg.dailyMaxUsd} per 24h (second limit, held here), absolute $${PAYOUT_ABSOLUTE_MAX_USD} per payout`);
  return { ok: problems.length === 0, info, problems };
}

// ── Installation ─────────────────────────────────────────────────────────────

export interface ConfiguredInstallResult extends InstallResult {
  mode: 'custody' | 'hot_key';
  /** Origin of the custody API, when in custody mode. */
  endpoint?: string;
}

export function installCustodyPayoutSigner(env: NodeJS.ProcessEnv = process.env, deps: CustodyDeps = {}): ConfiguredInstallResult {
  const cfg = resolveCustodyConfig(env);
  const key = readAgentKey(env);
  setPayoutBroadcaster(new CustodyPayoutBroadcaster(cfg, key, deps));
  void log().then((l) => l.warn(
    { chain: cfg.chain, endpoint: cfg.baseUrl, dailyMaxUsd: cfg.dailyMaxUsd },
    '[custody-signer] CUSTODY SIGNER INSTALLED — this service can now move stablecoins by asking custody to pay',
  ));
  return { installed: true, mode: 'custody', chain: cfg.chain, endpoint: cfg.baseUrl };
}

/**
 * The one entry point the service calls at startup. Which signer is chosen is explicit:
 *   PAYOUT_SIGNER_MODE unset or "hot_key"  → the existing hot-wallet signer, exactly as before;
 *   PAYOUT_SIGNER_MODE="custody"           → this one;
 *   anything else                          → refuse to start, because a typo here would otherwise pick a signer silently.
 */
export function installConfiguredPayoutSigner(env: NodeJS.ProcessEnv = process.env, deps: CustodyDeps = {}): ConfiguredInstallResult {
  const mode = env['PAYOUT_SIGNER_MODE'];
  if (mode === undefined || mode === '' || mode === 'hot_key') return { ...installPayoutSigner(), mode: 'hot_key' };
  if (mode !== 'custody') {
    throw new CustodyConfigError(`PAYOUT_SIGNER_MODE="${mode}" is not recognised. Use "custody", or "hot_key" (or leave it unset) for the hot-wallet signer.`);
  }
  if (env['PAYOUT_SIGNER_ENABLED'] !== 'true') {
    return { installed: false, mode: 'custody', reason: 'PAYOUT_SIGNER_ENABLED is not "true" — outbound payouts remain refused in production.' };
  }
  return installCustodyPayoutSigner(env, deps);
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.tokens';
import { AuditService } from '../database/audit.service';
import { CustomerService, Customer } from '../customers/customer.service';
import { SignService, SignResult } from '../sign/sign.service';
import { SignRequestDto } from '../sign/dto/sign-request.dto';
import { generateApiKey, hashApiKey } from '../auth/api-key.util';
import { requiredApprovals } from './quorum';
import { KeysService } from './keys.service';
import { EthereumService } from '../blockchain/ethereum.service';

export type ProposalKind = 'add_signer' | 'remove_signer' | 'set_threshold' | 'approve_transaction';

interface ProposalRow {
  id: string;
  customer_id: string;
  kind: ProposalKind;
  payload: Record<string, any>;
  status: string;
  required: number;
  request_id: string | null;
  created_by: string;
}

interface SignerRow {
  id: string;
  email: string;
  status: string;
  active_from: Date;
}

const DEFAULT_GAS_PRICE_WEI = '20000000000';
const SEPOLIA_CHAIN_ID = 11155111;

/** Parse a decimal ETH amount ("1.5") into a base-10 wei string, exactly. */
export function ethToWei(eth: string): string {
  if (!/^\d+(\.\d{1,18})?$/.test(eth)) {
    throw new BadRequestException('amount must be a positive decimal with at most 18 places');
  }
  const [whole, frac = ''] = eth.split('.');
  const wei = BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, '0'));
  if (wei <= 0n) throw new BadRequestException('amount must be greater than zero');
  return wei.toString();
}

/**
 * Custody governance for one workspace (an openfireblocks customer): the
 * signer roster, quorum proposals and votes, transfers that wait for
 * approval, and named API keys for connected applications.
 *
 * Every mutation here is called by an admin-authenticated caller (the FORGE
 * console) acting for a named person (`actor`), and every one is audited.
 */
@Injectable()
export class CustodyService {
  private readonly logger = new Logger(CustodyService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly customers: CustomerService,
    private readonly sign: SignService,
    private readonly audit: AuditService,
    private readonly http: HttpService,
    private readonly keys: KeysService,
    private readonly ethereum: EthereumService,
  ) {}

  private async ensureSettings(customerId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO custody.settings (customer_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [customerId],
    );
  }

  private async eligibleSigner(customerId: string, email: string): Promise<SignerRow> {
    const { rows } = await this.pool.query<SignerRow>(
      `SELECT id, email, status, active_from FROM custody.signers
        WHERE customer_id = $1 AND lower(email) = lower($2)`,
      [customerId, email],
    );
    const signer = rows[0];
    if (!signer || signer.status !== 'active') {
      throw new ForbiddenException(`${email} is not an active signer for this workspace`);
    }
    if (new Date(signer.active_from) > new Date()) {
      throw new ForbiddenException(
        `${email} is still in the cooling-off period until ${new Date(signer.active_from).toISOString()}`,
      );
    }
    return signer;
  }

  // ── Signers ────────────────────────────────────────────────────────────

  /**
   * The first signer can't be voted in — there is nobody to vote. Allowed only
   * while the roster is empty, and the bootstrap signer is active immediately.
   */
  async bootstrapSigner(customerId: string, email: string, name?: string) {
    await this.customers.getByCustomerId(customerId);
    await this.ensureSettings(customerId);
    const { rows: existing } = await this.pool.query(
      `SELECT 1 FROM custody.signers WHERE customer_id = $1 AND status = 'active' LIMIT 1`,
      [customerId],
    );
    if (existing.length > 0) {
      throw new ConflictException('this workspace already has signers; new signers must be proposed and approved');
    }
    const { rows } = await this.pool.query(
      `INSERT INTO custody.signers (customer_id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, email) DO UPDATE
         SET status = 'active', active_from = NOW(), removed_at = NULL, name = EXCLUDED.name
       RETURNING id, email, name, status, added_at, active_from`,
      [customerId, email, name ?? null],
    );
    // Start creating the workspace's key now so the first transfer isn't the
    // one that waits for it. Best effort: it is created on demand otherwise.
    if (this.keys.thresholdEnabled) {
      void this.keys.ensureKey(customerId).catch((err) =>
        this.logger.warn(`background key creation for ${customerId} failed: ${err?.message ?? err}`),
      );
    }
    await this.audit.logEvent({
      type: 'SIGNER_BOOTSTRAPPED',
      customerId,
      actor: email,
      message: `${email} became the first signer`,
      status: 'executed',
    });
    return rows[0];
  }

  // ── Proposals & votes ──────────────────────────────────────────────────

  async propose(customerId: string, actor: string, kind: ProposalKind, payload: Record<string, any>) {
    if (kind === 'approve_transaction') {
      throw new BadRequestException('transfer approvals are created by submitting a transfer, not proposed directly');
    }
    await this.ensureSettings(customerId);
    await this.eligibleSigner(customerId, actor);
    this.validateGovernancePayload(kind, payload);

    const required = await requiredApprovals(this.pool, customerId);
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO custody.proposals (customer_id, kind, payload, required, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [customerId, kind, JSON.stringify(payload), required, actor],
    );
    await this.audit.logEvent({
      type: 'PROPOSAL_CREATED',
      customerId,
      actor,
      message: `${kind} ${JSON.stringify(payload)}; needs ${required} approval(s)`,
      status: 'open',
    });
    // Proposing is itself an approval from the proposer.
    return this.vote(customerId, rows[0].id, actor, true);
  }

  private validateGovernancePayload(kind: ProposalKind, payload: Record<string, any>) {
    if (kind === 'add_signer' || kind === 'remove_signer') {
      if (typeof payload.email !== 'string' || !payload.email.includes('@')) {
        throw new BadRequestException('payload.email must be an email address');
      }
    }
    if (kind === 'set_threshold') {
      if (!Number.isInteger(payload.threshold) || payload.threshold < 1) {
        throw new BadRequestException('payload.threshold must be a positive integer');
      }
    }
  }

  async vote(customerId: string, proposalId: string, actor: string, approve: boolean) {
    const signer = await this.eligibleSigner(customerId, actor);
    const proposal = await this.getProposal(customerId, proposalId);
    if (proposal.status !== 'open') {
      throw new ConflictException(`proposal is already ${proposal.status}`);
    }
    try {
      await this.pool.query(
        `INSERT INTO custody.votes (proposal_id, signer_id, approve) VALUES ($1, $2, $3)`,
        [proposalId, signer.id, approve],
      );
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException(`${actor} has already voted on this proposal`);
      throw err;
    }
    await this.audit.logEvent({
      type: approve ? 'PROPOSAL_APPROVED_BY' : 'PROPOSAL_REJECTED_BY',
      customerId,
      requestId: proposal.request_id ?? undefined,
      actor,
      message: `${proposal.kind} ${proposalId}`,
      status: 'open',
    });
    return this.evaluate(customerId, proposalId);
  }

  /**
   * Re-run signing for a transfer that reached quorum but failed to sign —
   * typically because too few signing nodes were reachable at that moment.
   * Approvals are not asked for again: the quorum already decided. Only one
   * caller can claim a failed proposal, so concurrent retries sign it once.
   */
  async retryTransfer(customerId: string, proposalId: string, actor: string) {
    await this.eligibleSigner(customerId, actor);
    const claimed = await this.pool.query<ProposalRow>(
      `UPDATE custody.proposals SET status = 'executed', result = NULL
        WHERE id = $1 AND customer_id = $2 AND kind = 'approve_transaction' AND status = 'failed'
        RETURNING *`,
      [proposalId, customerId],
    );
    if (!claimed.rows[0]) {
      throw new ConflictException('only an approved transfer whose signing failed can be retried');
    }
    await this.audit.logEvent({
      type: 'PROPOSAL_RETRIED',
      customerId,
      requestId: claimed.rows[0].request_id ?? undefined,
      actor,
      message: `retrying signing for ${proposalId}`,
      status: 'retrying',
    });
    await this.execute(claimed.rows[0]);
    return this.proposalView(customerId, proposalId);
  }

  private async getProposal(customerId: string, proposalId: string): Promise<ProposalRow> {
    const { rows } = await this.pool.query<ProposalRow>(
      `SELECT * FROM custody.proposals WHERE id = $1 AND customer_id = $2`,
      [proposalId, customerId],
    );
    if (!rows[0]) throw new NotFoundException('proposal not found');
    return rows[0];
  }

  /**
   * Decide a proposal once enough votes are in. Only votes from signers who
   * are still active count, so removing a signer can't leave their vote
   * standing on proposals they didn't see through.
   */
  private async evaluate(customerId: string, proposalId: string) {
    const client = await this.pool.connect();
    let decided: { proposal: ProposalRow; outcome: 'approve' | 'reject' } | null = null;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<ProposalRow>(
        `SELECT * FROM custody.proposals WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
        [proposalId, customerId],
      );
      const proposal = rows[0];
      if (proposal.status === 'open') {
        const tally = await this.tally(client, customerId, proposalId);
        if (tally.approvals >= proposal.required) {
          decided = { proposal, outcome: 'approve' };
        } else if (tally.eligible - tally.rejections < proposal.required) {
          decided = { proposal, outcome: 'reject' };
        }
        if (decided) {
          await client.query(
            `UPDATE custody.proposals SET status = $2, decided_at = NOW() WHERE id = $1`,
            [proposalId, decided.outcome === 'approve' ? 'executed' : 'rejected'],
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    if (decided?.outcome === 'approve') {
      await this.execute(decided.proposal);
    } else if (decided?.outcome === 'reject') {
      await this.onRejected(decided.proposal);
    }
    return this.proposalView(customerId, proposalId);
  }

  private async tally(client: PoolClient, customerId: string, proposalId: string) {
    const { rows } = await client.query<{ approvals: string; rejections: string; eligible: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE v.approve AND s.status = 'active')     AS approvals,
         COUNT(*) FILTER (WHERE NOT v.approve AND s.status = 'active') AS rejections,
         (SELECT COUNT(*) FROM custody.signers
           WHERE customer_id = $1 AND status = 'active' AND active_from <= NOW()) AS eligible
       FROM custody.votes v JOIN custody.signers s ON s.id = v.signer_id
       WHERE v.proposal_id = $2`,
      [customerId, proposalId],
    );
    return {
      approvals: Number(rows[0].approvals),
      rejections: Number(rows[0].rejections),
      eligible: Number(rows[0].eligible),
    };
  }

  private async execute(proposal: ProposalRow) {
    const customerId = proposal.customer_id;
    let result: Record<string, any> = {};
    try {
      switch (proposal.kind) {
        case 'add_signer': {
          const { rows } = await this.pool.query<{ cooling_off_hours: number }>(
            `SELECT cooling_off_hours FROM custody.settings WHERE customer_id = $1`,
            [customerId],
          );
          const hours = rows[0]?.cooling_off_hours ?? 24;
          await this.pool.query(
            `INSERT INTO custody.signers (customer_id, email, name, active_from)
             VALUES ($1, $2, $3, NOW() + make_interval(hours => $4))
             ON CONFLICT (customer_id, email) DO UPDATE
               SET status = 'active', removed_at = NULL, name = EXCLUDED.name,
                   active_from = NOW() + make_interval(hours => $4)`,
            [customerId, proposal.payload.email, proposal.payload.name ?? null, hours],
          );
          result = { activeAfterHours: hours };
          break;
        }
        case 'remove_signer': {
          const { rows } = await this.pool.query<{ n: string }>(
            `SELECT COUNT(*) AS n FROM custody.signers WHERE customer_id = $1 AND status = 'active'`,
            [customerId],
          );
          if (Number(rows[0].n) <= 1) throw new Error('cannot remove the last active signer');
          await this.pool.query(
            `UPDATE custody.signers SET status = 'removed', removed_at = NOW()
              WHERE customer_id = $1 AND lower(email) = lower($2)`,
            [customerId, proposal.payload.email],
          );
          break;
        }
        case 'set_threshold': {
          await this.pool.query(
            `UPDATE custody.settings SET threshold = $2, updated_at = NOW() WHERE customer_id = $1`,
            [customerId, proposal.payload.threshold],
          );
          break;
        }
        case 'approve_transaction': {
          const customer = await this.customers.getByCustomerId(customerId);
          const signed: SignResult = await this.sign.executeSigning(
            customer,
            proposal.payload.request as SignRequestDto,
            proposal.request_id!,
          );
          result = {
            txHash: signed.txHash,
            status: signed.status,
            ...(signed.broadcastError ? { broadcastError: signed.broadcastError } : {}),
          };
          break;
        }
      }
      await this.pool.query(`UPDATE custody.proposals SET result = $2 WHERE id = $1`, [
        proposal.id,
        JSON.stringify(result),
      ]);
      await this.audit.logEvent({
        type: 'PROPOSAL_EXECUTED',
        customerId,
        requestId: proposal.request_id ?? undefined,
        message: `${proposal.kind} ${JSON.stringify(proposal.kind === 'approve_transaction' ? result : proposal.payload)}`,
        status: 'executed',
      });
    } catch (err) {
      // Sign failures carry the real reason in the exception body's `detail`
      // ("only 1 of 3 signing nodes are reachable…"); .message is generic.
      const body = (err as { getResponse?: () => unknown }).getResponse?.();
      const detail = typeof body === 'object' && body ? (body as { detail?: unknown }).detail : undefined;
      const message = typeof detail === 'string' && detail ? detail : (err as Error).message;
      this.logger.error(`proposal ${proposal.id} failed to execute: ${message}`);
      await this.pool.query(
        `UPDATE custody.proposals SET status = 'failed', result = $2 WHERE id = $1`,
        [proposal.id, JSON.stringify({ error: message })],
      );
      await this.audit.logEvent({
        type: 'PROPOSAL_FAILED',
        customerId,
        requestId: proposal.request_id ?? undefined,
        message,
        status: 'failed',
        errorMessage: message,
      });
    }
  }

  private async onRejected(proposal: ProposalRow) {
    if (proposal.kind === 'approve_transaction' && proposal.request_id) {
      await this.pool.query(
        `UPDATE signing.transactions SET status = 'rejected', updated_at = NOW() WHERE request_id = $1`,
        [proposal.request_id],
      );
    }
    await this.audit.logEvent({
      type: 'PROPOSAL_REJECTED',
      customerId: proposal.customer_id,
      requestId: proposal.request_id ?? undefined,
      message: proposal.kind,
      status: 'rejected',
    });
  }

  private async proposalView(customerId: string, proposalId: string) {
    const { rows } = await this.pool.query(
      `SELECT p.id, p.kind, p.payload, p.status, p.required, p.request_id, p.created_by,
              p.created_at, p.decided_at, p.result,
              COALESCE(json_agg(json_build_object('email', s.email, 'approve', v.approve, 'voted_at', v.voted_at))
                FILTER (WHERE v.signer_id IS NOT NULL), '[]') AS votes
         FROM custody.proposals p
         LEFT JOIN custody.votes v ON v.proposal_id = p.id
         LEFT JOIN custody.signers s ON s.id = v.signer_id
        WHERE p.id = $1 AND p.customer_id = $2
        GROUP BY p.id`,
      [proposalId, customerId],
    );
    return rows[0];
  }

  // ── Transfers initiated from the console ───────────────────────────────

  /**
   * A transfer requested by a person in the console. It goes through exactly
   * the same pipeline as an API-submitted one: policy, risk, then either an
   * immediate signature or the approval queue.
   *
   * With a network RPC configured the console supplies only to/value: chain id,
   * gas, EIP-1559 fees and the balance check happen in SignService, and the
   * nonce is allocated when the transfer is actually signed (see NonceService)
   * so a transfer that waits for approval, or is rejected, never leaves a hole.
   * With no RPC there is nothing to ask, so the old fixed Sepolia defaults apply
   * and the transfer is signing-only.
   */
  async initiateTransfer(customerId: string, actor: string, to: string, amountEth: string): Promise<SignResult> {
    await this.eligibleSigner(customerId, actor);
    const customer = await this.customers.getByCustomerId(customerId);
    const request = {
      to,
      value: ethToWei(amountEth),
      ...(this.ethereum.canBroadcast
        ? {}
        : { chainId: SEPOLIA_CHAIN_ID, gasLimit: 21000, gasPrice: DEFAULT_GAS_PRICE_WEI }),
    } as SignRequestDto;
    await this.audit.logEvent({
      type: 'TRANSFER_INITIATED',
      customerId,
      actor,
      message: `${amountEth} ETH to ${to}`,
      status: 'pending',
    });
    return this.sign.sign(customer, request, actor);
  }

  /** Resend a signed-but-not-broadcast transfer (same signed bytes). Signers only. */
  async rebroadcastTransfer(customerId: string, requestId: string, actor: string) {
    await this.eligibleSigner(customerId, actor);
    return this.sign.rebroadcast(customerId, requestId, actor);
  }

  // ── Connected applications (API keys) ──────────────────────────────────

  async issueApiKey(customerId: string, actor: string, name: string) {
    await this.customers.getByCustomerId(customerId);
    if (!name?.trim()) throw new BadRequestException('name is required');
    const key = generateApiKey();
    const { rows } = await this.pool.query(
      `INSERT INTO custody.api_keys (customer_id, name, key_prefix, key_hash, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, key_prefix, created_at`,
      [customerId, name.trim(), key.slice(0, 12), hashApiKey(key), actor],
    );
    await this.audit.logEvent({
      type: 'API_KEY_ISSUED',
      customerId,
      actor,
      message: `${name.trim()} (${key.slice(0, 12)}…)`,
      status: 'executed',
    });
    // The only time the full key is ever returned.
    return { ...rows[0], api_key: key };
  }

  async revokeApiKey(customerId: string, actor: string, keyId: string) {
    const { rows } = await this.pool.query(
      `UPDATE custody.api_keys SET revoked_at = NOW()
        WHERE id = $1 AND customer_id = $2 AND revoked_at IS NULL
        RETURNING name, key_prefix`,
      [keyId, customerId],
    );
    if (!rows[0]) throw new NotFoundException('active API key not found');
    await this.audit.logEvent({
      type: 'API_KEY_REVOKED',
      customerId,
      actor,
      message: `${rows[0].name} (${rows[0].key_prefix}…)`,
      status: 'executed',
    });
    return { revoked: true };
  }

  // ── Console summary ────────────────────────────────────────────────────

  private async legacySigningKey() {
    const url = process.env.MPC_SIGNER_URL ?? 'http://localhost:8080';
    try {
      const res = await lastValueFrom(this.http.get<{ address: string }>(`${url}/address`));
      return { address: res.data.address, reachable: true };
    } catch {
      return { address: null, reachable: false };
    }
  }

  /**
   * What signs this workspace's transfers, described as it actually is: either
   * its own threshold key (with the nodes that hold shares and whether they
   * answer right now) or the signer's one shared key.
   */
  private async signingKeyView(customerId: string) {
    if (!this.keys.thresholdEnabled) {
      const key = await this.legacySigningKey();
      return {
        mode: 'single',
        provisioned: true,
        address: key.address,
        signer_reachable: key.reachable,
        scheme: 'single ECDSA key',
        threshold: '1-of-1',
        shared_across_workspaces: true,
        storage: process.env.VAULT_ADDR ? 'HashiCorp Vault' : 'environment variable',
        nodes: [],
        trust_domains: 1,
        can_sign: key.reachable,
        created_at: null,
        legacy_signer_address: null,
      };
    }
    const [key, mpc] = await Promise.all([this.keys.activeKey(customerId), this.keys.status()]);
    const needed = mpc?.signersNeeded ?? (key ? key.threshold + 1 : 0);
    const total = mpc?.total ?? key?.nodes.length ?? 0;
    return {
      mode: 'threshold',
      provisioned: !!key,
      address: key?.address ?? null,
      signer_reachable: !!mpc?.enabled,
      scheme: 'threshold ECDSA',
      threshold: total ? `${needed}-of-${total}` : '—',
      shared_across_workspaces: false,
      storage: 'key shares on separate signing nodes; the full key never exists',
      nodes: mpc?.nodes ?? [],
      trust_domains: mpc?.trustDomains ?? 0,
      can_sign: !!mpc?.canSign,
      created_at: key?.created_at ?? null,
      // Set when this workspace signed with the old shared key before it had its own.
      legacy_signer_address: key?.legacy_signer_address ?? null,
    };
  }

  /**
   * Network the gateway broadcasts to, and the signing address's balance on it.
   * Never throws and never hangs the console: an unreachable RPC is reported, not raised.
   */
  private async networkView(address: string | null) {
    const confirmations = Number(process.env.TX_CONFIRMATIONS) > 0 ? Number(process.env.TX_CONFIRMATIONS) : 1;
    const view = {
      rpc_configured: this.ethereum.canBroadcast,
      chain_id: null as number | null,
      network_name: null as string | null,
      address,
      balance_wei: null as string | null,
      balance_error: null as string | null,
      confirmations_required: confirmations,
    };
    if (!view.rpc_configured) return view;
    const within = <T>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);
    try {
      const net = await within(this.ethereum.getNetworkInfo(), 5000);
      view.chain_id = net.chainId;
      view.network_name = net.name;
      if (address) view.balance_wei = (await within(this.ethereum.getBalance(address), 5000)).toString();
    } catch (err) {
      view.balance_error = `network unreachable: ${(err as Error).message}`;
    }
    return view;
  }

  async consoleSummary(customerId: string) {
    const customer: Customer = await this.customers.getByCustomerId(customerId);
    await this.ensureSettings(customerId);
    const q = (sql: string, params: unknown[] = [customerId]): Promise<any[]> =>
      this.pool.query(sql, params).then((r) => r.rows);

    const [settings, signers, proposals, transactions, audit, apiKeys, stats, key, required] =
      await Promise.all([
        q(`SELECT threshold, cooling_off_hours FROM custody.settings WHERE customer_id = $1`),
        q(`SELECT id, email, name, status, added_at, active_from, removed_at,
                  (status = 'active' AND active_from <= NOW()) AS eligible
             FROM custody.signers WHERE customer_id = $1 ORDER BY added_at`),
        q(`SELECT p.id, p.kind, p.payload, p.status, p.required, p.request_id, p.created_by,
                  p.created_at, p.decided_at, p.result,
                  COALESCE(json_agg(json_build_object('email', s.email, 'approve', v.approve, 'voted_at', v.voted_at))
                    FILTER (WHERE v.signer_id IS NOT NULL), '[]') AS votes,
                  (SELECT json_build_object('status', t.status, 'tx_hash', t.tx_hash, 'nonce', t.nonce,
                                            'block_number', t.block_number, 'confirmations', t.confirmation_count,
                                            'detail', t.status_detail, 'chain_id', t.chain_id)
                     FROM signing.transactions t WHERE t.request_id = p.request_id) AS tx
             FROM custody.proposals p
             LEFT JOIN custody.votes v ON v.proposal_id = p.id
             LEFT JOIN custody.signers s ON s.id = v.signer_id
            WHERE p.customer_id = $1
            GROUP BY p.id ORDER BY p.created_at DESC LIMIT 50`),
        q(`SELECT request_id, to_address, amount, nonce, status, tx_hash, created_at, updated_at,
                  chain_id, block_number, confirmation_count AS confirmations, status_detail AS detail
             FROM signing.transactions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`),
        q(`SELECT id, event_type, actor, request_id, message, status, error_message, created_at
             FROM audit.events WHERE customer_id = $1 ORDER BY id DESC LIMIT 50`),
        q(`SELECT id, name, key_prefix, created_by, created_at, last_used_at, revoked_at
             FROM custody.api_keys WHERE customer_id = $1 ORDER BY created_at DESC`),
        q(`SELECT
             COUNT(*) FILTER (WHERE status IN ('signed','broadcasting','signed_not_broadcast','broadcasted','confirmed','stuck') AND updated_at > NOW() - INTERVAL '24 hours') AS signed_24h,
             COUNT(*) FILTER (WHERE status = 'pending_approval') AS pending_approval,
             COALESCE(SUM(amount::numeric) FILTER (WHERE status IN ('signed','broadcasting','signed_not_broadcast','broadcasted','confirmed','stuck') AND updated_at > NOW() - INTERVAL '24 hours'), 0)::text AS signed_wei_24h
           FROM signing.transactions WHERE customer_id = $1`),
        this.signingKeyView(customerId),
        requiredApprovals(this.pool, customerId),
      ]);
    const network = await this.networkView(key.address);
    const [denied] = await q(
      `SELECT COUNT(*) AS n FROM audit.events
        WHERE customer_id = $1 AND event_type IN ('POLICY_DENIED','RISK_DENIED','APPROVAL_UNAVAILABLE')
          AND created_at > NOW() - INTERVAL '7 days'`,
    );

    return {
      workspace: { customer_id: customer.customer_id, email: customer.email, tier: customer.tier, status: customer.status },
      settings: { ...settings[0], effective_required: required },
      stats: {
        signed_24h: Number(stats[0].signed_24h),
        signed_wei_24h: stats[0].signed_wei_24h,
        pending_approval: Number(stats[0].pending_approval),
        denied_7d: Number(denied.n),
        active_signers: signers.filter((s: any) => s.status === 'active').length,
        connected_apps: apiKeys.filter((k: any) => !k.revoked_at).length,
      },
      signing_key: key,
      network,
      signers,
      proposals,
      transactions,
      audit,
      api_keys: apiKeys,
    };
  }
}

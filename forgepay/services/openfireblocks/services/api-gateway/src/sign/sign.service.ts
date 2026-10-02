import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { sealPayload } from '../common/proposal-seal';
import { installSignerAuth } from '../common/signer-auth';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { v4 as uuid } from 'uuid';
import { PostgresService } from '../database/postgres.service';
import { AuditService } from '../database/audit.service';
import { EthereumService } from '../blockchain/ethereum.service';
import { PolicyService } from '../policies/policy.service';
import { RiskService } from '../risk/risk.service';
import { BillingService } from '../billing/billing.service';
import { MetricsService } from '../monitoring/metrics.service';
import { Customer } from '../customers/customer.service';
import { SignRequestDto } from './dto/sign-request.dto';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.tokens';
import { requiredApprovals } from '../custody/quorum';
import { KeysService } from '../custody/keys.service';
import { NonceService } from '../blockchain/nonce.service';
import { TransferPlanner } from '../blockchain/transfer-planner.service';

// Shape of the MPC signer's /sign response.
interface MpcSignResponse {
  requestId: string;
  signedTx: string;
  txHash: string;
  from: string;
  status: string;
  auditLogId: number;
}

export interface SignResult {
  requestId: string;
  signedTx: string | null;
  txHash: string | null;
  from: string | null;
  // signed: signed only (no network configured). signed_not_broadcast: signed, but the
  // network refused or couldn't be reached - see broadcastError; Rebroadcast resends it.
  status: 'signed' | 'broadcasted' | 'signed_not_broadcast' | 'failed' | 'pending_approval';
  broadcasted: boolean;
  broadcastError?: string;
  proposalId?: string;
  requiredApprovals?: number;
}

/** The most useful one-line explanation an RPC/ethers error carries. */
export function describeRpcError(err: unknown): string {
  const e = err as any;
  const msg: string = e?.info?.error?.message ?? e?.error?.message ?? e?.shortMessage ?? e?.message ?? String(err);
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

// Orchestrates a Phase 1 sign request, scoped to an authenticated tenant:
//   audit(received) -> policy check -> MPC sign -> persist -> optional broadcast -> audit
// Every branch (including policy denials and failures) is recorded in the
// per-tenant PostgreSQL audit trail and counted in Prometheus metrics.
/** null = no ceiling (development only); otherwise the largest value an API key may auto-sign, in wei. */
export function apiKeyAutoSignCap(workspaceSetting: unknown, env: NodeJS.ProcessEnv = process.env): bigint | null {
  const raw = workspaceSetting ?? env.API_KEY_AUTO_SIGN_MAX_WEI;
  if (raw !== undefined && raw !== null && String(raw) !== '') {
    try { const n = BigInt(String(raw)); return n < 0n ? 0n : n; } catch { return 0n; }
  }
  return env.NODE_ENV === 'production' ? 0n : null;
}

export function hasCalldata(data?: string): boolean {
  return !!data && data !== '0x' && data.length > 2;
}

/** The recipient/spender of a standard ERC-20 transfer, approve or transferFrom, if that is what the data is. */
export function embeddedTokenRecipient(data?: string): string | null {
  if (!hasCalldata(data)) return null;
  const hex = data!.replace(/^0x/, '').toLowerCase();
  const argIndex: Record<string, number> = { a9059cbb: 0, '095ea7b3': 0, '23b872dd': 1 };
  const idx = argIndex[hex.slice(0, 8)];
  if (idx === undefined || hex.length < 8 + 64 * (idx + 1)) return null;
  const word = hex.slice(8 + 64 * idx, 8 + 64 * (idx + 1));
  return '0x' + word.slice(24);
}

@Injectable()
export class SignService {
  private readonly logger = new Logger(SignService.name);

  constructor(
    private readonly http: HttpService,
    private readonly postgres: PostgresService,
    private readonly audit: AuditService,
    private readonly ethereum: EthereumService,
    private readonly policy: PolicyService,
    private readonly risk: RiskService,
    private readonly billing: BillingService,
    private readonly metrics: MetricsService,
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly keys: KeysService,
    private readonly nonces: NonceService,
    private readonly planner: TransferPlanner,
  ) {
    installSignerAuth(this.http);
  }

  private legacyAddressCache: string | null = null;

  /** The address that signs for this workspace: its own threshold key, or the shared signer key. */
  async signingAddress(customerId: string): Promise<string> {
    if (this.keys.thresholdEnabled) return (await this.keys.ensureKey(customerId)).address;
    if (!this.legacyAddressCache) {
      const url = process.env.MPC_SIGNER_URL ?? 'http://localhost:8080';
      const res = await lastValueFrom(this.http.get<{ address: string }>(`${url}/address`, { timeout: 5000 }));
      this.legacyAddressCache = res.data.address;
    }
    return this.legacyAddressCache;
  }

  /** With no network to ask, chain id and fees must come from the caller (or safe defaults for a plain transfer). */
  private offlineFields(req: SignRequestDto) {
    if (req.chainId == null) throw new BadRequestException('chainId is required because no network is configured');
    if (!req.gasPrice && !req.maxFeePerGas) {
      throw new BadRequestException('gasPrice or maxFeePerGas is required because no network is configured to estimate fees');
    }
    let gasLimit = req.gasLimit;
    if (gasLimit == null) {
      if (req.data && req.data !== '0x') throw new BadRequestException('gasLimit is required for a contract call when no network is configured');
      gasLimit = 21000;
    }
    return { chainId: req.chainId, gasLimit, gasPrice: req.gasPrice, maxFeePerGas: req.maxFeePerGas, maxPriorityFeePerGas: req.maxPriorityFeePerGas };
  }

  /**
   * Before anything is queued or signed: with a network, fill in chain id / gas /
   * fees and refuse a transfer the address can't pay for. Returns the request to
   * store (chain id resolved; nonce and fees are still decided at signing time).
   */
  private async preflight(customerId: string, req: SignRequestDto): Promise<SignRequestDto> {
    if (!this.ethereum.canBroadcast) {
      this.offlineFields(req);
      return req;
    }
    const from = await this.signingAddress(customerId);
    const planned = await this.planner.plan(from, req, 'request');
    return { ...req, chainId: planned.chainId };
  }

  /** `initiatedBy` names the person when a transfer was requested in a console, not by an API key. */
  async sign(customer: Customer, req: SignRequestDto, initiatedBy?: string): Promise<SignResult> {
    const requestId = uuid();
    const customerId = customer.customer_id;
    const stopTimer = this.metrics.signLatency.startTimer({ chain: 'ethereum' });

    await this.audit.logEvent({
      type: 'SIGN_REQUEST_RECEIVED',
      requestId,
      customerId,
      message: `to=${req.to} value=${req.value ?? '0'} nonce=${req.nonce}`,
      status: 'pending',
    });

    try {
      // 1. Policy evaluation (fail-closed).
      const overrides = (customer.policies ?? {}) as Record<string, unknown>;
      const decision = { ...(await this.policy.evaluate({
        customerId,
        customerTier: customer.tier,
        to: req.to,
        value: req.value ?? '0',
        // The policy engine sees the network's chain id when the caller left it out.
        chainId: req.chainId ?? (this.ethereum.canBroadcast ? await this.ethereum.getChainId().catch(() => 0) : 0),
        whitelist: overrides.whitelist as string[] | undefined,
        blockedCountries: overrides.blockedCountries as string[] | undefined,
        country: req.country,
      })) };

      // The policy engine sees only `to` and `value`. A contract call can move tokens to someone else
      // while looking like a zero-value call to the token. So (a) the recipient inside a standard token call
      // is put through the same policy, and (b) any call carrying data waits for a human quorum rather
      // than being signed because its native value is zero.
      const embedded = embeddedTokenRecipient(req.data);
      if (decision.approved && embedded) {
        const second = await this.policy.evaluate({
          customerId, customerTier: customer.tier, to: embedded, value: '0',
          chainId: req.chainId ?? 0, whitelist: overrides.whitelist as string[] | undefined,
          blockedCountries: overrides.blockedCountries as string[] | undefined, country: req.country,
        });
        if (!second.approved) {
          decision.approved = false;
          decision.denials = [...decision.denials, ...second.denials.map((d) => `token recipient: ${d}`)];
        }
      }
      // Transfers started by an API key (not by a person in the console) auto-sign only up to a ceiling the
      // workspace sets (policies.apiKeyAutoSignMaxWei, else API_KEY_AUTO_SIGN_MAX_WEI). In production the
      // default ceiling is zero: a leaked key can ask for transfers but not make them without a quorum.
      if (decision.approved && !decision.requiresApproval && !initiatedBy) {
        const cap = apiKeyAutoSignCap(overrides.apiKeyAutoSignMaxWei);
        if (cap !== null && (cap === 0n || BigInt(req.value ?? '0') > cap)) {
          decision.requiresApproval = true;
          decision.reason = [decision.reason, 'API-key transfer above the auto-sign ceiling: needs human approval'].filter(Boolean).join('; ');
        }
      }
      if (decision.approved && hasCalldata(req.data) && !decision.requiresApproval) {
        decision.requiresApproval = true;
        decision.reason = [decision.reason, 'contract call: needs human approval'].filter(Boolean).join('; ');
      }

      if (!decision.approved) {
        for (const d of decision.denials) {
          this.metrics.policyDenials.inc({ policy_type: d });
        }
        await this.audit.logEvent({
          type: 'POLICY_DENIED',
          requestId,
          customerId,
          message: decision.denials.join('; '),
          status: 'denied',
        });
        this.metrics.signRequests.inc({ status: 'denied', chain: 'ethereum' });
        throw new ForbiddenException({
          error: 'policy denied',
          denials: decision.denials,
          requiresApproval: decision.requiresApproval,
          requestId,
        });
      }

      // 1a. Can the address pay? Chain id, gas and fees are resolved and the balance is
      // checked before the transfer counts against velocity, is queued, or is signed.
      let request: SignRequestDto;
      try {
        request = await this.preflight(customerId, req);
      } catch (err) {
        if (err instanceof HttpException) {
          await this.audit.logEvent({
            type: 'PREFLIGHT_REJECTED',
            requestId,
            customerId,
            message: err.message,
            status: 'denied',
          });
        }
        throw err;
      }

      // 1b. Velocity / risk control (per-tenant hourly transaction limit).
      const velocity = await this.risk.checkAndRecord(customerId, customer.tier);
      if (!velocity.allowed) {
        this.metrics.riskDenials.inc({ reason: 'velocity' });
        await this.audit.logEvent({
          type: 'RISK_DENIED',
          requestId,
          customerId,
          message: velocity.reason,
          status: 'denied',
        });
        this.metrics.signRequests.inc({ status: 'denied', chain: 'ethereum' });
        throw new ForbiddenException({
          error: 'risk denied',
          reason: velocity.reason,
          requestId,
        });
      }

      // 1c. The policy engine can approve a transfer *and* require a human
      // sign-off (e.g. > 10 ETH). That used to be ignored and the transfer
      // signed immediately; it now waits in the custody approval queue and is
      // only signed once a quorum of active signers approves it.
      if (decision.requiresApproval) {
        return await this.queueForApproval(customer, request, requestId, decision.reason, initiatedBy);
      }

      return await this.executeSigning(customer, request, requestId);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const message = (error as Error).message;
      this.metrics.signRequests.inc({ status: 'failed', chain: 'ethereum' });
      await this.audit.logEvent({
        type: 'SIGN_FAILED',
        requestId,
        customerId,
        status: 'failed',
        errorMessage: message,
      });
      throw new InternalServerErrorException({ error: 'Signing failed', detail: message, requestId });
    } finally {
      stopTimer();
    }
  }

  private async queueForApproval(
    customer: Customer,
    req: SignRequestDto,
    requestId: string,
    reason: string,
    initiatedBy?: string,
  ): Promise<SignResult> {
    const customerId = customer.customer_id;
    const required = await requiredApprovals(this.pool, customerId);
    if (required === 0) {
      await this.audit.logEvent({
        type: 'APPROVAL_UNAVAILABLE',
        requestId,
        customerId,
        message: 'transfer requires approval but no signers are configured',
        status: 'denied',
      });
      this.metrics.signRequests.inc({ status: 'denied', chain: 'ethereum' });
      throw new ForbiddenException({
        error: 'approval required',
        reason: 'this transfer requires signer approval, and no signers are configured for this workspace',
        requestId,
      });
    }

    await this.postgres.saveTransaction({
      requestId,
      customerId,
      chain: 'ethereum',
      to: req.to,
      data: req.data ?? '',
      value: req.value ?? '0',
      gasLimit: req.gasLimit,
      gasPrice: req.gasPrice ?? req.maxFeePerGas ?? '',
      nonce: req.nonce,
      signedTx: '',
      txHash: null,
      status: 'pending_approval',
    });
    const proposal = await this.pool.query<{ id: string }>(
      `INSERT INTO custody.proposals (customer_id, kind, payload, required, request_id, created_by)
       VALUES ($1, 'approve_transaction', $2, $3, $4, $5) RETURNING id`,
      [customerId, JSON.stringify(sealPayload(customerId, 'approve_transaction', requestId, { request: req, reason })), required, requestId, initiatedBy ?? 'api key'],
    );
    await this.audit.logEvent({
      type: 'APPROVAL_REQUIRED',
      requestId,
      customerId,
      message: `${reason}; needs ${required} signer approval(s)`,
      status: 'pending_approval',
    });
    this.metrics.signRequests.inc({ status: 'pending_approval', chain: 'ethereum' });
    return {
      requestId,
      signedTx: null,
      txHash: null,
      from: null,
      status: 'pending_approval',
      broadcasted: false,
      proposalId: proposal.rows[0].id,
      requiredApprovals: required,
    };
  }

  /**
   * MPC-sign, persist, audit, meter and (if an RPC is configured) broadcast.
   * Called directly for transfers that need no approval, and by the custody
   * service once an approval proposal reaches quorum.
   *
   * With a network configured, whatever the caller left out is filled in here,
   * at the moment of signing: fees and gas are re-estimated, the balance is
   * re-checked (it may have changed while the transfer waited for approval),
   * and the nonce is allocated under the per-address lock (see NonceService).
   */
  async executeSigning(customer: Customer, req: SignRequestDto, requestId: string): Promise<SignResult> {
    const customerId = customer.customer_id;
    const canBroadcast = this.ethereum.canBroadcast;
    let persisted = false;
    try {
      // 2. Call the MPC signer service.
      const mpcSignerUrl =
        process.env.MPC_SIGNER_URL ?? 'http://localhost:8080';
      // With threshold signing on, each workspace signs with its own key,
      // created across the signing nodes the first time it's needed.
      const key = this.keys.thresholdEnabled ? await this.keys.ensureKey(customerId) : null;
      // The address is needed up front to pick a nonce or check a balance. With an explicit
      // nonce and no network, nothing needs it until the signer answers.
      const needFrom = canBroadcast || req.nonce == null;
      const from = key?.address ?? (needFrom ? await this.signingAddress(customerId) : null);

      const signAndPersist = async () => {
        // Idempotent on requestId. If this request was already signed (a retry after a failure that came
        // after the signature was stored, a double click, a replayed proposal), hand back what exists
        // instead of asking the signers for a second signature on a new nonce: that would be two
        // transfers for one approval.
        const prior = await this.postgres.getTransaction(requestId, customerId);
        if (prior?.signed_tx && prior?.tx_hash) {
          persisted = true;
          const status = String(prior.status);
          const known = status === 'broadcasted' || status === 'signed_not_broadcast' || status === 'failed';
          return {
            signedTx: prior.signed_tx as string,
            txHash: prior.tx_hash as string,
            from: (prior.from_address as string | null) ?? from,
            outcome: canBroadcast
              ? { status: (known ? status : 'signed_not_broadcast') as 'broadcasted' | 'signed_not_broadcast' | 'failed', txHash: prior.tx_hash as string, error: undefined as string | undefined }
              : null,
            reused: true,
          };
        }
        const fields = canBroadcast ? await this.planner.plan(from!, req, 'signing') : this.offlineFields(req);
        let nonce = req.nonce;
        if (nonce == null) {
          const pending = canBroadcast ? await this.planner.rpcPendingNonce(from!) : null;
          nonce = await this.nonces.next(from!, fields.chainId, pending);
        }
        const { gasPrice: _g, maxFeePerGas: _m, maxPriorityFeePerGas: _p, ...rest } = req;
        let signBody: Record<string, unknown> = {
          ...rest,
          chainId: fields.chainId,
          gasLimit: fields.gasLimit,
          nonce,
          ...(fields.gasPrice ? { gasPrice: fields.gasPrice } : {}),
          ...(fields.maxFeePerGas ? { maxFeePerGas: fields.maxFeePerGas, maxPriorityFeePerGas: fields.maxPriorityFeePerGas } : {}),
        };
        if (key) signBody = { ...signBody, keyId: key.key_id, expectedAddress: key.address };
        const response = await lastValueFrom(
          this.http.post<MpcSignResponse>(`${mpcSignerUrl}/sign`, signBody, { timeout: 120000 }),
        );
        const { signedTx, txHash, from: signedBy } = response.data;

        // 3. Persist transaction metadata, tenant-scoped. This row is what owns the nonce from
        // here on, and it is written before the address lock is released. With a network the
        // status is 'broadcasting' (a claim: only the holder broadcasts, or Rebroadcast can't race
        // it); without one the transfer is signing-only and stays 'signed'.
        await this.postgres.saveTransaction({
          requestId,
          customerId,
          chain: 'ethereum',
          to: req.to,
          data: req.data ?? '',
          value: req.value ?? '0',
          gasLimit: fields.gasLimit,
          // Record the effective fee: legacy gasPrice, else the 1559 fee cap.
          gasPrice: fields.gasPrice ?? fields.maxFeePerGas ?? '',
          nonce,
          signedTx,
          txHash,
          status: canBroadcast ? 'broadcasting' : 'signed',
          fromAddress: signedBy ?? from,
          chainId: fields.chainId,
        });
        persisted = true;

        await this.audit.logEvent({
          type: 'SIGN_SUCCESS',
          requestId,
          customerId,
          signature: signedTx.slice(0, 66),
          hash: txHash,
          status: 'signed',
        });
        // Meter usage (best-effort; never blocks signing).
        await this.billing.recordSigned(customerId);

        // 4. Broadcast if a network is configured, still inside the address lock so that
        // transfers from one address reach the node in nonce order (a node given nonce 3
        // before nonce 2 has to park it). A failure is recorded as 'signed_not_broadcast'
        // with the RPC's error, never reported as success.
        const outcome = canBroadcast ? await this.broadcastStored(requestId, customerId, signedTx, txHash) : null;
        return { signedTx, txHash, from: signedBy ?? from, outcome, reused: false };
      };
      // A transfer with a chosen nonce still queues behind others for the same address, so the
      // balance check below sees the funds the earlier ones already claimed.
      const { signedTx, txHash, from: signedFrom, outcome } = from
        ? await this.nonces.withAddressLock(from, signAndPersist)
        : await signAndPersist();

      if (!outcome) {
        this.metrics.signRequests.inc({ status: 'signed', chain: 'ethereum' });
        return { requestId, signedTx, txHash, from: signedFrom, status: 'signed', broadcasted: false };
      }
      this.metrics.signRequests.inc({ status: outcome.status, chain: 'ethereum' });
      return {
        requestId,
        signedTx,
        txHash: outcome.txHash,
        from: signedFrom,
        status: outcome.status,
        broadcasted: outcome.status === 'broadcasted',
        ...(outcome.error ? { broadcastError: outcome.error } : {}),
      };
    } catch (error) {
      // The signer explains itself (e.g. "only 1 of 3 signing nodes are
      // reachable; 2 are needed") — pass that on instead of "status code 503".
      const detail = (error as any)?.response?.data?.error;
      const message = detail ?? (error as Error).message;
      this.metrics.signRequests.inc({ status: 'failed', chain: 'ethereum' });
      if (!persisted) {
        // Nothing was signed, so no nonce was consumed: nothing to give back.
        await this.postgres.updateStatus(requestId, 'failed', undefined, message).catch(() => undefined);
      }
      await this.audit.logEvent({
        type: 'SIGN_FAILED',
        requestId,
        customerId,
        status: 'failed',
        errorMessage: message,
      });
      throw new InternalServerErrorException({
        error: 'Signing failed',
        detail: message,
        requestId,
      });
    }
  }

  /**
   * Send an already-signed transaction (row status 'broadcasting') and record what
   * happened: broadcasted, signed_not_broadcast (error kept), or failed for the
   * one case where the network proves the signed bytes can never be mined.
   */
  private async broadcastStored(
    requestId: string,
    customerId: string,
    signedTx: string,
    expectedHash: string,
  ): Promise<{ status: 'broadcasted' | 'signed_not_broadcast' | 'failed'; txHash: string; error?: string }> {
    const accepted = async (hash: string) => {
      await this.postgres.updateStatus(requestId, 'broadcasted', hash);
      await this.billing.recordBroadcast(customerId);
      await this.audit.logEvent({ type: 'BROADCAST_SUCCESS', requestId, customerId, hash, status: 'broadcasted' });
      return { status: 'broadcasted' as const, txHash: hash };
    };
    let hash: string;
    try {
      // Only the network call is inside the try: a database error while recording a
      // successful broadcast must never be mistaken for the network refusing it.
      hash = await this.ethereum.broadcastTransaction(signedTx);
    } catch (broadcastErr) {
      const message = describeRpcError(broadcastErr);
      if (/already known|known transaction|already imported|already in the pool/i.test(message)) {
        return accepted(expectedHash); // the network has these exact bytes already
      }
      if (/nonce too low|correct nonce|nonce.*already/i.test(message)) {
        // Either these bytes were mined earlier (fine) or another transaction took the nonce.
        const receipt = await this.ethereum.getTransactionReceipt(expectedHash).catch(() => null);
        if (receipt) return accepted(expectedHash);
        const reason = `the network refused it: ${message}. Its nonce was used by a different transaction, so this signed transaction can never be mined.`;
        await this.postgres.updateStatus(requestId, 'failed', undefined, reason);
        await this.audit.logEvent({ type: 'BROADCAST_FAILED', requestId, customerId, hash: expectedHash, status: 'failed', errorMessage: reason });
        this.metrics.broadcastErrors.inc({ chain: 'ethereum', reason: 'nonce' });
        return { status: 'failed', txHash: expectedHash, error: reason };
      }
      this.logger.error(`broadcast failed for ${requestId}: ${message}`);
      this.metrics.broadcastErrors.inc({ chain: 'ethereum', reason: 'rpc' });
      await this.postgres.updateStatus(requestId, 'signed_not_broadcast', undefined, message);
      await this.audit.logEvent({
        type: 'BROADCAST_FAILED',
        requestId,
        customerId,
        hash: expectedHash,
        status: 'signed_not_broadcast',
        errorMessage: message,
      });
      return { status: 'signed_not_broadcast', txHash: expectedHash, error: message };
    }
    return accepted(hash);
  }

  /**
   * Resend a transaction that was signed but never reached the network. It sends
   * the SAME signed bytes (no new signature, same nonce and hash). Race-safe:
   * the row is claimed with one UPDATE, so of two simultaneous clicks exactly one
   * broadcasts and the other gets a 409.
   */
  async rebroadcast(customerId: string, requestId: string, actor?: string) {
    if (!this.ethereum.canBroadcast) throw new ConflictException('no network is configured, so there is nothing to broadcast to');
    const claimed = await this.pool.query<{ signed_tx: string; tx_hash: string }>(
      `UPDATE signing.transactions SET status = 'broadcasting', updated_at = NOW()
        WHERE request_id = $1 AND customer_id = $2 AND status = 'signed_not_broadcast' AND signed_tx <> ''
        RETURNING signed_tx, tx_hash`,
      [requestId, customerId],
    );
    if (!claimed.rows[0]) {
      throw new ConflictException('only a transaction that was signed but not broadcast can be rebroadcast');
    }
    await this.audit.logEvent({
      type: 'BROADCAST_RETRIED',
      requestId,
      customerId,
      actor,
      message: 'rebroadcasting the original signed transaction',
      status: 'retrying',
    });
    const { signed_tx, tx_hash } = claimed.rows[0];
    const outcome = await this.broadcastStored(requestId, customerId, signed_tx, tx_hash);
    if (outcome.status === 'signed_not_broadcast') {
      throw new BadGatewayException(`Rebroadcast failed: ${outcome.error}`);
    }
    return { requestId, status: outcome.status, txHash: outcome.txHash, ...(outcome.error ? { error: outcome.error } : {}) };
  }
}

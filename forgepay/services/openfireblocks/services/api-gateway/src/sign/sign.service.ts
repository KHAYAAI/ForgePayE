import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
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
  status: 'signed' | 'broadcasted' | 'pending_approval';
  broadcasted: boolean;
  proposalId?: string;
  requiredApprovals?: number;
}

// Orchestrates a Phase 1 sign request, scoped to an authenticated tenant:
//   audit(received) -> policy check -> MPC sign -> persist -> optional broadcast -> audit
// Every branch (including policy denials and failures) is recorded in the
// per-tenant PostgreSQL audit trail and counted in Prometheus metrics.
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
  ) {}

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
      const decision = await this.policy.evaluate({
        customerId,
        customerTier: customer.tier,
        to: req.to,
        value: req.value ?? '0',
        chainId: req.chainId,
        whitelist: overrides.whitelist as string[] | undefined,
        blockedCountries: overrides.blockedCountries as string[] | undefined,
        country: req.country,
      });

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
        return await this.queueForApproval(customer, req, requestId, decision.reason, initiatedBy);
      }

      return await this.executeSigning(customer, req, requestId);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof InternalServerErrorException) {
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
      [customerId, JSON.stringify({ request: req, reason }), required, requestId, initiatedBy ?? 'api key'],
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
   */
  async executeSigning(customer: Customer, req: SignRequestDto, requestId: string): Promise<SignResult> {
    const customerId = customer.customer_id;
    try {
      // 2. Call the MPC signer service.
      const mpcSignerUrl =
        process.env.MPC_SIGNER_URL ?? 'http://localhost:8080';
      // With threshold signing on, each workspace signs with its own key,
      // created across the signing nodes the first time it's needed.
      let signBody: Record<string, unknown> = { ...req };
      if (this.keys.thresholdEnabled) {
        const key = await this.keys.ensureKey(customerId);
        signBody = { ...req, keyId: key.key_id, expectedAddress: key.address };
      }
      const response = await lastValueFrom(
        this.http.post<MpcSignResponse>(`${mpcSignerUrl}/sign`, signBody, { timeout: 120000 }),
      );
      const { signedTx, txHash, from } = response.data;

      // 3. Persist transaction metadata (status: signed), tenant-scoped.
      await this.postgres.saveTransaction({
        requestId,
        customerId,
        chain: 'ethereum',
        to: req.to,
        data: req.data ?? '',
        value: req.value ?? '0',
        gasLimit: req.gasLimit,
        // Record the effective fee: legacy gasPrice, else the 1559 fee cap.
        gasPrice: req.gasPrice ?? req.maxFeePerGas ?? '',
        nonce: req.nonce,
        signedTx,
        txHash,
        status: 'signed',
      });

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

      // 4. Broadcast to the network if an RPC endpoint is configured.
      let broadcasted = false;
      let finalHash = txHash;
      if (this.ethereum.canBroadcast) {
        try {
          finalHash = await this.ethereum.broadcastTransaction(signedTx);
          broadcasted = true;
          await this.postgres.updateStatus(requestId, 'broadcasted', finalHash);
          await this.billing.recordBroadcast(customerId);
          await this.audit.logEvent({
            type: 'BROADCAST_SUCCESS',
            requestId,
            customerId,
            hash: finalHash,
            status: 'broadcasted',
          });
        } catch (broadcastErr) {
          const message = (broadcastErr as Error).message;
          this.logger.error(`broadcast failed for ${requestId}: ${message}`);
          this.metrics.broadcastErrors.inc({ chain: 'ethereum', reason: 'rpc' });
          await this.audit.logEvent({
            type: 'BROADCAST_FAILED',
            requestId,
            customerId,
            hash: txHash,
            status: 'failed',
            errorMessage: message,
          });
        }
      }

      this.metrics.signRequests.inc({
        status: broadcasted ? 'broadcasted' : 'signed',
        chain: 'ethereum',
      });

      return {
        requestId,
        signedTx,
        txHash: finalHash,
        from,
        status: broadcasted ? 'broadcasted' : 'signed',
        broadcasted,
      };
    } catch (error) {
      // The signer explains itself (e.g. "only 1 of 3 signing nodes are
      // reachable; 2 are needed") — pass that on instead of "status code 503".
      const detail = (error as any)?.response?.data?.error;
      const message = detail ?? (error as Error).message;
      this.metrics.signRequests.inc({ status: 'failed', chain: 'ethereum' });
      await this.postgres.updateStatus(requestId, 'failed').catch(() => undefined);
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
}

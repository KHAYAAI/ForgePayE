import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { of } from 'rxjs';
import { SignService } from './sign.service';
import { PostgresService } from '../database/postgres.service';
import { AuditService } from '../database/audit.service';
import { EthereumService } from '../blockchain/ethereum.service';
import { PolicyService } from '../policies/policy.service';
import { RiskService } from '../risk/risk.service';
import { BillingService } from '../billing/billing.service';
import { MetricsService } from '../monitoring/metrics.service';
import { Customer } from '../customers/customer.service';
import { SignRequestDto } from './dto/sign-request.dto';
import { PG_POOL } from '../database/database.tokens';
import { KeysService } from '../custody/keys.service';
import { NonceService } from '../blockchain/nonce.service';
import { TransferPlanner } from '../blockchain/transfer-planner.service';

// Unit tests for the Phase 1 sign orchestration. External collaborators (MPC
// signer, PostgreSQL, Ethereum RPC, policy service) are mocked, so this runs
// without infra and asserts policy/audit/persist/broadcast wiring.
describe('SignService', () => {
  let audit: { logEvent: jest.Mock };
  let postgres: { saveTransaction: jest.Mock; updateStatus: jest.Mock; getTransaction: jest.Mock };
  let policy: { evaluate: jest.Mock };
  let risk: { checkAndRecord: jest.Mock };
  let billing: { recordSigned: jest.Mock; recordBroadcast: jest.Mock };
  let pool: { query: jest.Mock };
  let mpcPost: jest.Mock;
  let keys: { thresholdEnabled: boolean; ensureKey: jest.Mock };
  let nonces: { withAddressLock: jest.Mock; next: jest.Mock };
  let planner: { plan: jest.Mock; rpcPendingNonce: jest.Mock };
  let httpGet: jest.Mock;

  const mpcResponse = {
    data: {
      requestId: 'mpc-req',
      signedTx: '0xsigned',
      txHash: '0xhash',
      from: '0xfrom',
      status: 'signed',
      auditLogId: 1,
    },
  };

  const customer: Customer = {
    id: 1,
    customer_id: 'demo',
    email: 'demo@x.io',
    api_key: 'k',
    status: 'active',
    tier: 'pro',
    policies: {},
  };

  const validReq: SignRequestDto = {
    chainId: 11155111,
    to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    data: '0x',
    value: '0',
    gasLimit: 21000,
    gasPrice: '20000000000',
    nonce: 0,
  };

  const approve = () => ({
    approved: true,
    denials: [],
    requiresApproval: false,
    reason: 'ok',
  });

  // `eligibleSigners`/`threshold` drive requiredApprovals(); the proposal
  // insert returns a fixed id.
  async function build(ethereum: Partial<EthereumService>, eligibleSigners = 2, threshold = 2) {
    pool = {
      query: jest.fn((sql: string) =>
        sql.includes('INSERT INTO custody.proposals')
          ? Promise.resolve({ rows: [{ id: 'proposal-1' }] })
          : Promise.resolve({ rows: [{ threshold, eligible: String(eligibleSigners) }] }),
      ),
    };
    mpcPost = jest.fn(() => of(mpcResponse));
    httpGet = jest.fn(() => of({ data: { address: '0xSharedSigner' } }));
    nonces = {
      withAddressLock: jest.fn((_addr: string, fn: () => Promise<unknown>) => fn()),
      next: jest.fn().mockResolvedValue(7),
    };
    planner = {
      plan: jest.fn().mockResolvedValue({
        chainId: 1337, gasLimit: 21000, maxFeePerGas: '30000000000', maxPriorityFeePerGas: '1500000000', maxFeeWei: 30000000000n,
      }),
      rpcPendingNonce: jest.fn().mockResolvedValue(3),
    };
    keys = { thresholdEnabled: false, ensureKey: jest.fn() };
    audit = { logEvent: jest.fn().mockResolvedValue(1) };
    postgres = {
      saveTransaction: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      getTransaction: jest.fn().mockResolvedValue(null),
    };
    policy = { evaluate: jest.fn().mockResolvedValue(approve()) };
    risk = {
      checkAndRecord: jest
        .fn()
        .mockResolvedValue({ allowed: true, count: 1, limit: 100 }),
    };
    billing = {
      recordSigned: jest.fn().mockResolvedValue(undefined),
      recordBroadcast: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SignService,
        MetricsService,
        { provide: HttpService, useValue: { post: mpcPost, get: httpGet } },
        { provide: NonceService, useValue: nonces },
        { provide: TransferPlanner, useValue: planner },
        { provide: PG_POOL, useValue: pool },
        { provide: KeysService, useValue: keys },
        { provide: PostgresService, useValue: postgres },
        { provide: AuditService, useValue: audit },
        { provide: EthereumService, useValue: ethereum },
        { provide: PolicyService, useValue: policy },
        { provide: RiskService, useValue: risk },
        { provide: BillingService, useValue: billing },
      ],
    }).compile();

    return moduleRef.get(SignService);
  }

  it('signs, persists and audits without broadcasting when RPC is disabled', async () => {
    const service = await build({ canBroadcast: false });
    const result = await service.sign(customer, validReq);

    expect(planner.plan).not.toHaveBeenCalled(); // no network: nothing to estimate or check
    expect(result.status).toBe('signed');
    expect(result.broadcasted).toBe(false);
    expect(postgres.saveTransaction).toHaveBeenCalledTimes(1);
    expect(postgres.saveTransaction.mock.calls[0][0].customerId).toBe('demo');
    expect(billing.recordSigned).toHaveBeenCalledWith('demo');

    const auditedTypes = audit.logEvent.mock.calls.map((c) => c[0].type);
    expect(auditedTypes).toContain('SIGN_REQUEST_RECEIVED');
    expect(auditedTypes).toContain('SIGN_SUCCESS');
  });

  it('a request that was already signed is returned as it was, never signed a second time', async () => {
    const service = await build({ canBroadcast: false });
    postgres.getTransaction.mockResolvedValue({ signed_tx: '0xalreadysigned', tx_hash: '0xalreadyhash', from_address: '0xfrom', status: 'signed' });
    const result = await service.executeSigning(customer, validReq, 'req-1');
    expect(mpcPost).not.toHaveBeenCalled();
    expect(postgres.saveTransaction).not.toHaveBeenCalled();
    expect(result.signedTx).toBe('0xalreadysigned');
    expect(result.txHash).toBe('0xalreadyhash');
  });

  describe('with a network RPC', () => {
    const rpc = (over: Partial<EthereumService> = {}) => ({
      canBroadcast: true,
      getChainId: jest.fn().mockResolvedValue(1337),
      broadcastTransaction: jest.fn().mockResolvedValue('0xbroadcasthash'),
      getTransactionReceipt: jest.fn().mockResolvedValue(null),
      ...over,
    });
    const bare = { to: validReq.to, value: '1000' } as SignRequestDto; // caller supplies only to/value

    it('fills in chain id, gas, fees and a nonce, signs, and broadcasts', async () => {
      const service = await build(rpc());
      keys.thresholdEnabled = true;
      keys.ensureKey.mockResolvedValue({ key_id: 'k', address: '0xWorkspaceKey' });
      const result = await service.sign(customer, bare);

      expect(result.status).toBe('broadcasted');
      expect(result.txHash).toBe('0xbroadcasthash');
      const body = mpcPost.mock.calls[0][1];
      expect(body).toMatchObject({ chainId: 1337, gasLimit: 21000, nonce: 7, maxFeePerGas: '30000000000', maxPriorityFeePerGas: '1500000000' });
      expect(body.gasPrice).toBeUndefined();
      // nonce = max(node pending, our records), decided under the per-address lock
      expect(nonces.withAddressLock).toHaveBeenCalledWith('0xWorkspaceKey', expect.any(Function));
      expect(nonces.next).toHaveBeenCalledWith('0xWorkspaceKey', 1337, 3);
      // the signed row is persisted as 'broadcasting' (a claim) before the network is touched
      expect(postgres.saveTransaction.mock.calls[0][0]).toMatchObject({ status: 'broadcasting', nonce: 7, chainId: 1337, fromAddress: '0xfrom' });
      expect(postgres.updateStatus).toHaveBeenCalledWith(expect.any(String), 'broadcasted', '0xbroadcasthash');
    });

    it('uses an explicit nonce as given', async () => {
      const service = await build(rpc());
      await service.sign(customer, { ...bare, nonce: 42 });
      expect(mpcPost.mock.calls[0][1].nonce).toBe(42);
      expect(nonces.next).not.toHaveBeenCalled();
    });

    it('records signed_not_broadcast with the RPC error instead of reporting success', async () => {
      const service = await build(rpc({ broadcastTransaction: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8545')) }));
      const result = await service.sign(customer, bare);

      expect(result.status).toBe('signed_not_broadcast');
      expect(result.broadcasted).toBe(false);
      expect(result.broadcastError).toContain('ECONNREFUSED');
      expect(postgres.updateStatus).toHaveBeenCalledWith(expect.any(String), 'signed_not_broadcast', undefined, expect.stringContaining('ECONNREFUSED'));
      expect(postgres.updateStatus).not.toHaveBeenCalledWith(expect.any(String), 'broadcasted', expect.anything());
      expect(audit.logEvent.mock.calls.map((c) => c[0].type)).toContain('BROADCAST_FAILED');
    });

    it('a database error while recording a successful broadcast is not reported as a broadcast failure', async () => {
      const service = await build(rpc());
      postgres.updateStatus.mockRejectedValueOnce(new Error('db hiccup'));
      await expect(service.sign(customer, bare)).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(postgres.updateStatus).not.toHaveBeenCalledWith(expect.any(String), 'signed_not_broadcast', undefined, expect.anything());
      expect(postgres.updateStatus).not.toHaveBeenCalledWith(expect.any(String), 'failed', undefined, expect.anything()); // signed row is kept for repair
    });

    it('treats "already known" as the same transaction being on the network', async () => {
      const service = await build(rpc({ broadcastTransaction: jest.fn().mockRejectedValue(new Error('already known')) }));
      const result = await service.sign(customer, bare);
      expect(result.status).toBe('broadcasted');
      expect(result.txHash).toBe('0xhash'); // the hash of the bytes we signed
    });

    it('marks a transaction failed (releasing its nonce) when the network says the nonce was used by another', async () => {
      const service = await build(rpc({ broadcastTransaction: jest.fn().mockRejectedValue(new Error('nonce too low')) }));
      const result = await service.sign(customer, bare);
      expect(result.status).toBe('failed');
      expect(postgres.updateStatus).toHaveBeenCalledWith(expect.any(String), 'failed', undefined, expect.stringContaining('can never be mined'));
    });

    it('does not sign or queue when the balance check refuses it', async () => {
      const service = await build(rpc());
      planner.plan.mockRejectedValueOnce(new BadRequestException('balance is 1 ETH; this transfer needs 25.001 ETH including fees'));
      await expect(service.sign(customer, bare)).rejects.toMatchObject({ message: expect.stringContaining('balance is 1 ETH; this transfer needs 25.001 ETH including fees') });
      expect(mpcPost).not.toHaveBeenCalled();
      expect(postgres.saveTransaction).not.toHaveBeenCalled();
      expect(risk.checkAndRecord).not.toHaveBeenCalled(); // a refused transfer doesn't burn velocity
    });

    it('checks the balance before queuing an approval, and allocates no nonce while it waits', async () => {
      const service = await build(rpc());
      policy.evaluate.mockResolvedValueOnce({ approved: true, denials: [], requiresApproval: true, reason: 'needs approval' });
      const result = await service.sign(customer, { ...bare, value: '25000000000000000000' });
      expect(planner.plan).toHaveBeenCalledWith('0xSharedSigner', expect.anything(), 'request');
      expect(result.status).toBe('pending_approval');
      expect(nonces.next).not.toHaveBeenCalled();
      expect(mpcPost).not.toHaveBeenCalled();
      expect(postgres.saveTransaction.mock.calls[0][0].nonce).toBeUndefined();
    });

    it('a failed signature leaves no signed row and consumes no nonce', async () => {
      const service = await build(rpc());
      mpcPost.mockImplementationOnce(() => { throw new Error('signer down'); });
      await expect(service.sign(customer, bare)).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(postgres.saveTransaction).not.toHaveBeenCalled();
      expect(postgres.updateStatus).toHaveBeenCalledWith(expect.any(String), 'failed', undefined, 'signer down');
    });
  });

  describe('rebroadcast', () => {
    it('resends the stored signed bytes without asking the signer again', async () => {
      const broadcast = jest.fn().mockResolvedValue('0xhash');
      const service = await build({ canBroadcast: true, broadcastTransaction: broadcast });
      pool.query.mockImplementation((sql: string) =>
        sql.includes("SET status = 'broadcasting'")
          ? Promise.resolve({ rows: [{ signed_tx: '0xstoredbytes', tx_hash: '0xhash' }] })
          : Promise.resolve({ rows: [] }),
      );
      const r = await service.rebroadcast('demo', 'req-1', 'a@x.io');
      expect(broadcast).toHaveBeenCalledWith('0xstoredbytes');
      expect(mpcPost).not.toHaveBeenCalled();
      expect(r.status).toBe('broadcasted');
    });

    it('refuses when the row is not signed_not_broadcast (lost the claim race or wrong state)', async () => {
      const broadcast = jest.fn();
      const service = await build({ canBroadcast: true, broadcastTransaction: broadcast });
      pool.query.mockResolvedValue({ rows: [] });
      await expect(service.rebroadcast('demo', 'req-1')).rejects.toBeInstanceOf(ConflictException);
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('puts the row back to signed_not_broadcast and reports the error when the network is still down', async () => {
      const service = await build({ canBroadcast: true, broadcastTransaction: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
      pool.query.mockImplementation((sql: string) =>
        sql.includes("SET status = 'broadcasting'")
          ? Promise.resolve({ rows: [{ signed_tx: '0xstoredbytes', tx_hash: '0xhash' }] })
          : Promise.resolve({ rows: [] }),
      );
      await expect(service.rebroadcast('demo', 'req-1')).rejects.toBeInstanceOf(BadGatewayException);
      expect(postgres.updateStatus).toHaveBeenCalledWith('req-1', 'signed_not_broadcast', undefined, expect.stringContaining('ECONNREFUSED'));
    });
  });

  it('denies and does not sign when policy rejects', async () => {
    const service = await build({ canBroadcast: false });
    policy.evaluate.mockResolvedValueOnce({
      approved: false,
      denials: ['Amount exceeds global limit'],
      requiresApproval: false,
      reason: '1 violation',
    });

    await expect(service.sign(customer, validReq)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(postgres.saveTransaction).not.toHaveBeenCalled();
    const auditedTypes = audit.logEvent.mock.calls.map((c) => c[0].type);
    expect(auditedTypes).toContain('POLICY_DENIED');
  });

  it('denies and does not sign when velocity limit is exceeded', async () => {
    const service = await build({ canBroadcast: false });
    risk.checkAndRecord.mockResolvedValueOnce({
      allowed: false,
      count: 101,
      limit: 100,
      reason: 'velocity limit exceeded',
    });

    await expect(service.sign(customer, validReq)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(postgres.saveTransaction).not.toHaveBeenCalled();
    const auditedTypes = audit.logEvent.mock.calls.map((c) => c[0].type);
    expect(auditedTypes).toContain('RISK_DENIED');
  });

  // Regression: the policy engine returns approved=true AND
  // requiresApproval=true for high-value transfers. The service used to check
  // only `approved` and sign immediately.
  describe('API-key transfers need a quorum above the workspace ceiling', () => {
    const approved = () => ({ approved: true, denials: [], requiresApproval: false, reason: 'ok' });
    it('in production, with no ceiling set, an API key cannot make a transfer without approval', async () => {
      const prev = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
      try {
        const service = await build({ canBroadcast: false });
        policy.evaluate.mockResolvedValue(approved());
        const result = await service.sign(customer, { ...validReq, value: '1' });
        expect(result.status).toBe('pending_approval');
        expect(mpcPost).not.toHaveBeenCalled();
      } finally { process.env.NODE_ENV = prev; }
    });
    it('a workspace ceiling lets small API-key transfers through and queues larger ones', async () => {
      const service = await build({ canBroadcast: false });
      policy.evaluate.mockResolvedValue(approved());
      const c = { ...customer, policies: { apiKeyAutoSignMaxWei: '1000' } };
      expect((await service.sign(c, { ...validReq, value: '1000' })).status).toBe('signed');
      expect((await service.sign(c, { ...validReq, value: '1001' })).status).toBe('pending_approval');
    });
    it('a person in the console is not subject to the API-key ceiling', async () => {
      const prev = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
      try {
        const service = await build({ canBroadcast: false });
        policy.evaluate.mockResolvedValue(approved());
        expect((await service.sign(customer, { ...validReq, value: '1' }, 'alice@example.com')).status).toBe('signed');
      } finally { process.env.NODE_ENV = prev; }
    });
  });

  describe('contract calls (the policy engine only sees `to` and `value`)', () => {
    const recipient = '0x000000000000000000000000000000000000bEEF';
    const transferData = '0xa9059cbb' + '000000000000000000000000' + recipient.slice(2).toLowerCase() + '00'.repeat(31) + '01';
    const approved = { approved: true, denials: [], requiresApproval: false, reason: 'ok' };

    it('a zero-value token transfer is not signed on the strength of its zero value: it waits for a quorum', async () => {
      const service = await build({ canBroadcast: false });
      policy.evaluate.mockResolvedValue(approved);
      const result = await service.sign(customer, { ...validReq, value: '0', data: transferData });
      expect(result.status).toBe('pending_approval');
      expect(mpcPost).not.toHaveBeenCalled();
    });

    it('the recipient inside a token transfer is put through the policy too, and a denial stops it', async () => {
      const service = await build({ canBroadcast: false });
      policy.evaluate
        .mockResolvedValueOnce(approved)
        .mockResolvedValueOnce({ approved: false, denials: ['destination sanctioned'], requiresApproval: false, reason: 'no' });
      await expect(service.sign(customer, { ...validReq, value: '0', data: transferData })).rejects.toBeInstanceOf(ForbiddenException);
      expect(policy.evaluate.mock.calls[1][0].to.toLowerCase()).toBe(recipient.toLowerCase());
      expect(mpcPost).not.toHaveBeenCalled();
    });

    it('a plain transfer is unaffected', async () => {
      const service = await build({ canBroadcast: false });
      policy.evaluate.mockResolvedValue(approved);
      const result = await service.sign(customer, validReq);
      expect(result.status).toBe('signed');
    });
  });

  it('queues instead of signing when the policy requires approval', async () => {
    const service = await build({ canBroadcast: false });
    policy.evaluate.mockResolvedValueOnce({
      approved: true,
      denials: [],
      requiresApproval: true,
      reason: 'approved, manual approval required',
    });

    const result = await service.sign(customer, { ...validReq, value: '20000000000000000000' });

    expect(result.status).toBe('pending_approval');
    expect(result.proposalId).toBe('proposal-1');
    expect(result.requiredApprovals).toBe(2);
    expect(mpcPost).not.toHaveBeenCalled();
    expect(postgres.saveTransaction.mock.calls[0][0].status).toBe('pending_approval');
    const auditedTypes = audit.logEvent.mock.calls.map((c) => c[0].type);
    expect(auditedTypes).toContain('APPROVAL_REQUIRED');
    expect(auditedTypes).not.toContain('SIGN_SUCCESS');
  });

  it('denies an approval-required transfer when no signers exist, never signs it', async () => {
    const service = await build({ canBroadcast: false }, 0);
    policy.evaluate.mockResolvedValueOnce({
      approved: true,
      denials: [],
      requiresApproval: true,
      reason: 'approved, manual approval required',
    });

    await expect(service.sign(customer, validReq)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mpcPost).not.toHaveBeenCalled();
    expect(postgres.saveTransaction).not.toHaveBeenCalled();
  });

  it('signs with the workspace\'s own threshold key when threshold signing is on', async () => {
    const service = await build({ canBroadcast: false });
    keys.thresholdEnabled = true;
    keys.ensureKey.mockResolvedValue({ key_id: 'key-abc', address: '0xWorkspaceKey' });

    await service.sign(customer, validReq);

    expect(keys.ensureKey).toHaveBeenCalledWith('demo');
    const body = mpcPost.mock.calls[0][1];
    expect(body.keyId).toBe('key-abc');
    expect(body.expectedAddress).toBe('0xWorkspaceKey');
  });

  it('does not touch keys or send a keyId when threshold signing is off', async () => {
    const service = await build({ canBroadcast: false });
    await service.sign(customer, validReq);
    expect(keys.ensureKey).not.toHaveBeenCalled();
    expect(mpcPost.mock.calls[0][1].keyId).toBeUndefined();
  });

  it('reports the signer\'s own explanation when a quorum of nodes is unreachable', async () => {
    const service = await build({ canBroadcast: false });
    mpcPost.mockImplementationOnce(() => {
      const err: any = new Error('Request failed with status code 503');
      err.response = { data: { error: 'only 1 of 3 signing nodes are reachable; 2 are needed to sign' } };
      throw err;
    });
    await expect(service.sign(customer, validReq)).rejects.toMatchObject({
      response: { detail: expect.stringContaining('only 1 of 3 signing nodes are reachable') },
    });
    expect(postgres.updateStatus).toHaveBeenCalledWith(expect.any(String), 'failed', undefined, expect.stringContaining('only 1 of 3'));
  });
});

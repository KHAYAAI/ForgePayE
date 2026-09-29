import { ethers } from 'ethers';
import { UserOpService } from '../../src/modules/account-abstraction/userop.service';

/**
 * CORRECTNESS TEST: Nonce & UserOp construction
 *
 * Verifies that:
 *  - buildUserOp uses the (on-chain) nonce, not a timestamp
 *  - v0.7 packed fields (accountGasLimits / gasFees) are bytes32
 *  - the userOpHash binds the nonce (and other fields) so it changes when they do
 *
 * These run fully offline: chain access (getNonce, gas price, gas estimate) is
 * mocked. End-to-end validation against a live EntryPoint is a separate,
 * network-dependent integration test (see the skipped block at the bottom).
 */
describe('Nonce & UserOp correctness', () => {
  let svc: UserOpService;

  const ethereumServiceMock = {
    getProvider: jest.fn(),
    estimateGas: jest.fn().mockResolvedValue(21000n),
    getGasPrice: jest.fn().mockResolvedValue(1_000_000_000n), // 1 gwei
  };
  const paymasterMock = {};
  const txRepoMock = {};

  const sender = ethers.getAddress('0x' + '1'.repeat(40));
  const target = ethers.getAddress('0x' + '2'.repeat(40));

  beforeEach(() => {
    svc = new UserOpService(
      txRepoMock as any,
      ethereumServiceMock as any,
      paymasterMock as any,
    );
    // Simulate an account whose current on-chain nonce is 7.
    jest.spyOn(svc as any, 'getNonce').mockResolvedValue(7);
  });

  it('uses the on-chain nonce (not a timestamp)', async () => {
    const userOp = await svc.buildUserOp(sender, target, '0x');
    expect(userOp.nonce).toBe('7');

    // A unix timestamp would be a 10-digit number; 7 is clearly a counter.
    expect(Number(userOp.nonce)).toBeLessThan(1_000_000);
  });

  it('packs accountGasLimits and gasFees as bytes32 (v0.7)', async () => {
    const userOp = await svc.buildUserOp(sender, target, '0x');

    // bytes32 => 0x + 64 hex chars.
    expect(userOp.accountGasLimits).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(userOp.gasFees).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('produces a 32-byte userOpHash', async () => {
    const userOp = await svc.buildUserOp(sender, target, '0x');
    const hash = (svc as any).calculateUserOpHash(userOp);
    expect(hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('binds the nonce into the userOpHash', async () => {
    const userOp = await svc.buildUserOp(sender, target, '0x');
    const hash1 = (svc as any).calculateUserOpHash(userOp);

    userOp.nonce = (Number(userOp.nonce) + 1).toString();
    const hash2 = (svc as any).calculateUserOpHash(userOp);

    expect(hash1).not.toEqual(hash2);
  });

  it('hash is deterministic for the same UserOp', async () => {
    const userOp = await svc.buildUserOp(sender, target, '0x');
    const a = (svc as any).calculateUserOpHash(userOp);
    const b = (svc as any).calculateUserOpHash(userOp);
    expect(a).toEqual(b);
  });

  it('signs the UserOp hash and returns a 65-byte signature', async () => {
    const wallet = ethers.Wallet.createRandom();
    const userOp = await svc.buildUserOp(sender, target, '0x');

    const signature = await svc.signUserOp(userOp, wallet.privateKey);

    expect(signature.startsWith('0x')).toBe(true);
    // 65-byte ECDSA signature => 0x + 130 hex chars.
    expect(signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
    expect(userOp.signature).toBe(signature);
  });
});

/**
 * INTEGRATION (requires a funded testnet account + deployed EntryPoint/account).
 * Intentionally skipped in unit runs; must pass before the AA path is trusted.
 */
describe.skip('Integration: UserOp accepted by EntryPoint (testnet)', () => {
  it('lands a UserOp without SIG_VALIDATION_FAILED', async () => {
    // 1. Deploy/resolve SimpleAccount via factory
    // 2. buildUserOp with our nonce + packed fields
    // 3. sign with the account owner key
    // 4. submit via bundler; assert success and nonce increment
  });
});

import { ethers } from 'ethers';
import { UserOpService } from '../../src/modules/account-abstraction/userop.service';

/**
 * ON-CHAIN CORRECTNESS: our userOpHash must equal the EntryPoint's.
 *
 * The canonical EntryPoint v0.7 exposes `getUserOpHash(PackedUserOperation)` as
 * a *view* — so this needs an RPC endpoint but NO gas and NO funded key. It is
 * the definitive proof that UserOpService.calculateUserOpHash matches what the
 * chain will sign against; if these agree, signatures over our hash validate.
 *
 * Skipped unless an EVM RPC with EntryPoint v0.7 deployed is provided:
 *   AA_RPC_URL=https://sepolia.example/... CHAIN_ID=11155111 \
 *     npx jest test/integration/userop-hash.integration.test.ts
 *
 * (Not run in CI here because outbound RPC is blocked by egress policy.)
 */
const RPC = process.env.AA_RPC_URL;
const ENTRYPOINT = process.env.ENTRYPOINT_ADDRESS ||
  '0x0000000071727De22E5E9d8BAf0edAc6f37da032'; // canonical v0.7
const CHAIN_ID = Number(process.env.CHAIN_ID) || 11155111;

const maybe = RPC ? describe : describe.skip;

maybe('UserOp hash matches on-chain EntryPoint.getUserOpHash', () => {
  const provider = new ethers.JsonRpcProvider(RPC);

  const entryPoint = new ethers.Contract(
    ENTRYPOINT,
    [
      'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)',
    ],
    provider,
  );

  let svc: UserOpService;

  beforeAll(() => {
    process.env.CHAIN_ID = String(CHAIN_ID);
    process.env.ENTRYPOINT_ADDRESS = ENTRYPOINT;
    svc = new UserOpService(
      {} as any,
      {
        getProvider: () => provider,
        estimateGas: async () => 21000n,
        getGasPrice: async () => 1_000_000_000n,
      } as any,
      {} as any,
    );
    jest.spyOn(svc as any, 'getNonce').mockResolvedValue(3);
  });

  it('agrees with the EntryPoint for a sample UserOp', async () => {
    const sender = ethers.getAddress('0x' + 'ab'.repeat(20));
    const target = ethers.getAddress('0x' + 'cd'.repeat(20));

    const userOp = await svc.buildUserOp(sender, target, '0x');
    const localHash = (svc as any).calculateUserOpHash(userOp);

    const onchainHash = await entryPoint.getUserOpHash({
      sender: userOp.sender,
      nonce: userOp.nonce,
      initCode: userOp.initCode,
      callData: userOp.callData,
      accountGasLimits: userOp.accountGasLimits,
      preVerificationGas: userOp.preVerificationGas,
      gasFees: userOp.gasFees,
      paymasterAndData: userOp.paymasterAndData,
      signature: '0x',
    });

    expect(localHash.toLowerCase()).toBe(onchainHash.toLowerCase());
  });
});

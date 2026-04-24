/**
 * NullifierRegistry contract tests (Hardhat + ethers v6)
 *
 * Tests the critical double-spending prevention mechanism:
 *   1. A nullifier can only be submitted once
 *   2. Frozen nullifiers cannot be submitted
 *   3. Only auditor can freeze nullifiers
 *   4. Proof verification failure reverts (stubbed to always pass)
 *
 * CURRENT STATE: STUB MODE — proofs always verified.
 * TODO: After Groth16Verifier is real, add tests with invalid proofs.
 */

import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('NullifierRegistry', () => {
  let verifier:  any;
  let registry:  any;
  let owner:     any;
  let auditorAcc: any;
  let stranger:  any;

  const NULLIFIER  = ethers.zeroPadValue(ethers.toBeHex(0xdeadbeef), 32);
  const MERKLE_ROOT = ethers.zeroPadValue(ethers.toBeHex(0xcafebabe), 32);
  const AMOUNT     = 1_000_000n;
  const PROOF      = ethers.toUtf8Bytes('stub_proof');

  beforeEach(async () => {
    [owner, auditorAcc, stranger] = await ethers.getSigners();

    const VerifierFactory = await ethers.getContractFactory('Groth16Verifier');
    verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();

    const RegistryFactory = await ethers.getContractFactory('NullifierRegistry');
    registry = await RegistryFactory.deploy(
      await verifier.getAddress(),
      auditorAcc.address
    );
    await registry.waitForDeployment();
  });

  describe('submitProof', () => {
    it('accepts a valid proof and marks nullifier as spent', async () => {
      await registry.submitProof(PROOF, NULLIFIER, MERKLE_ROOT, AMOUNT);

      expect(await registry.isSpent(NULLIFIER)).to.equal(true);
    });

    it('emits PaymentConfirmed on success', async () => {
      await expect(registry.submitProof(PROOF, NULLIFIER, MERKLE_ROOT, AMOUNT))
        .to.emit(registry, 'PaymentConfirmed')
        .withArgs(NULLIFIER, MERKLE_ROOT, owner.address, AMOUNT, await latestTimestamp());
    });

    it('reverts on double-spend: same nullifier submitted twice', async () => {
      await registry.submitProof(PROOF, NULLIFIER, MERKLE_ROOT, AMOUNT);

      await expect(
        registry.submitProof(PROOF, NULLIFIER, MERKLE_ROOT, AMOUNT)
      ).to.be.revertedWithCustomError(registry, 'NullifierAlreadySpent')
        .withArgs(NULLIFIER);
    });

    it('reverts when nullifier is frozen by auditor', async () => {
      await registry.connect(auditorAcc).freezeNullifier(NULLIFIER, 'sanctions compliance');

      await expect(
        registry.submitProof(PROOF, NULLIFIER, MERKLE_ROOT, AMOUNT)
      ).to.be.revertedWithCustomError(registry, 'NullifierFrozenError')
        .withArgs(NULLIFIER);
    });

    it('reverts for zero nullifier', async () => {
      const zeroNullifier = ethers.zeroPadValue('0x', 32);
      await expect(
        registry.submitProof(PROOF, zeroNullifier, MERKLE_ROOT, AMOUNT)
      ).to.be.revertedWithCustomError(registry, 'InvalidNullifier');
    });
  });

  describe('freezeNullifier', () => {
    it('auditor can freeze a nullifier', async () => {
      await registry.connect(auditorAcc).freezeNullifier(NULLIFIER, 'test freeze');
      expect(await registry.isFrozen(NULLIFIER)).to.equal(true);
    });

    it('emits NullifierFrozen event', async () => {
      await expect(
        registry.connect(auditorAcc).freezeNullifier(NULLIFIER, 'sanctions')
      )
        .to.emit(registry, 'NullifierFrozen')
        .withArgs(NULLIFIER, auditorAcc.address, 'sanctions', await latestTimestamp());
    });

    it('non-auditor cannot freeze', async () => {
      await expect(
        registry.connect(stranger).freezeNullifier(NULLIFIER, 'unauthorized')
      ).to.be.revertedWithCustomError(registry, 'NotAuditor');
    });

    it('auditor can unfreeze a nullifier', async () => {
      await registry.connect(auditorAcc).freezeNullifier(NULLIFIER, 'freeze');
      await registry.connect(auditorAcc).unfreezeNullifier(NULLIFIER);
      expect(await registry.isFrozen(NULLIFIER)).to.equal(false);
    });
  });

  describe('admin', () => {
    it('owner can update verifier address', async () => {
      const newVerifier = ethers.Wallet.createRandom().address;
      await expect(registry.updateVerifier(newVerifier))
        .to.emit(registry, 'VerifierUpdated')
        .withArgs(await verifier.getAddress(), newVerifier);
      expect(await registry.verifier()).to.equal(newVerifier);
    });

    it('non-owner cannot update verifier', async () => {
      await expect(
        registry.connect(stranger).updateVerifier(ethers.Wallet.createRandom().address)
      ).to.be.revertedWithCustomError(registry, 'NotOwner');
    });

    it('owner can transfer ownership', async () => {
      await registry.transferOwnership(stranger.address);
      expect(await registry.owner()).to.equal(stranger.address);
    });
  });
});

async function latestTimestamp(): Promise<bigint> {
  const block = await ethers.provider.getBlock('latest');
  return BigInt(block!.timestamp + 1); // approximate next block timestamp
}

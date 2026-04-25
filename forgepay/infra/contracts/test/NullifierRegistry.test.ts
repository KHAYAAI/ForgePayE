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
import { AbiCoder } from 'ethers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProofBytes(): Uint8Array {
  const coder = AbiCoder.defaultAbiCoder();
  const encoded = coder.encode(
    ['uint256[2]', 'uint256[2][2]', 'uint256[2]'],
    [[0n, 0n], [[0n, 0n], [0n, 0n]], [0n, 0n]]
  );
  return ethers.getBytes(encoded);
}

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

  // ── submitProof ──────────────────────────────────────────────────────────

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

    // ── Full lifecycle ─────────────────────────────────────────────────────

    it('full lifecycle: submit proof → nullifier recorded → cannot submit again (NullifierAlreadySpent)', async () => {
      const nullifier2 = ethers.zeroPadValue(ethers.toBeHex(0xaaaa1234), 32);

      // Step 1: Initially not spent
      expect(await registry.isSpent(nullifier2)).to.equal(false);

      // Step 2: Submit proof → success
      await registry.submitProof(makeProofBytes(), nullifier2, MERKLE_ROOT, 500n);
      expect(await registry.isSpent(nullifier2)).to.equal(true);

      // Step 3: Second submission → double-spend revert
      await expect(
        registry.submitProof(makeProofBytes(), nullifier2, MERKLE_ROOT, 500n)
      ).to.be.revertedWithCustomError(registry, 'NullifierAlreadySpent')
        .withArgs(nullifier2);
    });

    it('different nullifiers can both be submitted independently', async () => {
      const nA = ethers.zeroPadValue(ethers.toBeHex(0xaaa), 32);
      const nB = ethers.zeroPadValue(ethers.toBeHex(0xbbb), 32);

      await registry.submitProof(makeProofBytes(), nA, MERKLE_ROOT, 100n);
      await registry.submitProof(makeProofBytes(), nB, MERKLE_ROOT, 200n);

      expect(await registry.isSpent(nA)).to.equal(true);
      expect(await registry.isSpent(nB)).to.equal(true);
    });
  });

  // ── freezeNullifier ──────────────────────────────────────────────────────

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

    it('non-auditor cannot freeze → revert NotAuditor', async () => {
      await expect(
        registry.connect(stranger).freezeNullifier(NULLIFIER, 'unauthorized')
      ).to.be.revertedWithCustomError(registry, 'NotAuditor');
    });

    it('owner (non-auditor) also cannot freeze → revert NotAuditor', async () => {
      // owner is not the auditor
      await expect(
        registry.connect(owner).freezeNullifier(NULLIFIER, 'owner attempt')
      ).to.be.revertedWithCustomError(registry, 'NotAuditor');
    });

    it('freeze flow: auditor freezes nullifier → submitProof reverts with NullifierFrozenError', async () => {
      const frozenNull = ethers.zeroPadValue(ethers.toBeHex(0xfeed), 32);

      // Freeze the nullifier first
      await registry.connect(auditorAcc).freezeNullifier(frozenNull, 'compliance hold');
      expect(await registry.isFrozen(frozenNull)).to.equal(true);

      // Now trying to submit a proof for that nullifier must fail
      await expect(
        registry.submitProof(makeProofBytes(), frozenNull, MERKLE_ROOT, 999n)
      ).to.be.revertedWithCustomError(registry, 'NullifierFrozenError')
        .withArgs(frozenNull);
    });

    it('auditor can unfreeze a nullifier', async () => {
      await registry.connect(auditorAcc).freezeNullifier(NULLIFIER, 'freeze');
      await registry.connect(auditorAcc).unfreezeNullifier(NULLIFIER);
      expect(await registry.isFrozen(NULLIFIER)).to.equal(false);
    });

    it('unfreezeNullifier: after unfreeze, submitProof succeeds', async () => {
      const nUnfreeze = ethers.zeroPadValue(ethers.toBeHex(0x9999), 32);

      // Freeze
      await registry.connect(auditorAcc).freezeNullifier(nUnfreeze, 'temp hold');
      // Unfreeze
      await registry.connect(auditorAcc).unfreezeNullifier(nUnfreeze);

      // Should now succeed
      await expect(
        registry.submitProof(makeProofBytes(), nUnfreeze, MERKLE_ROOT, 1n)
      ).to.emit(registry, 'PaymentConfirmed');
    });

    it('non-auditor cannot unfreeze → revert NotAuditor', async () => {
      await registry.connect(auditorAcc).freezeNullifier(NULLIFIER, 'freeze');
      await expect(
        registry.connect(stranger).unfreezeNullifier(NULLIFIER)
      ).to.be.revertedWithCustomError(registry, 'NotAuditor');
    });
  });

  // ── admin ────────────────────────────────────────────────────────────────

  describe('admin', () => {
    it('owner can update verifier address', async () => {
      const newVerifier = ethers.Wallet.createRandom().address;
      await expect(registry.updateVerifier(newVerifier))
        .to.emit(registry, 'VerifierUpdated')
        .withArgs(await verifier.getAddress(), newVerifier);
      expect(await registry.verifier()).to.equal(newVerifier);
    });

    it('non-owner cannot update verifier → revert NotOwner', async () => {
      await expect(
        registry.connect(stranger).updateVerifier(ethers.Wallet.createRandom().address)
      ).to.be.revertedWithCustomError(registry, 'NotOwner');
    });

    it('auditor cannot update verifier → revert NotOwner', async () => {
      await expect(
        registry.connect(auditorAcc).updateVerifier(ethers.Wallet.createRandom().address)
      ).to.be.revertedWithCustomError(registry, 'NotOwner');
    });

    it('updateVerifier works correctly: new verifier address is persisted', async () => {
      // Deploy a second verifier instance and point the registry to it
      const VerifierFactory = await ethers.getContractFactory('Groth16Verifier');
      const verifier2 = await VerifierFactory.deploy();
      await verifier2.waitForDeployment();
      const v2Addr = await verifier2.getAddress();

      await registry.updateVerifier(v2Addr);
      expect(await registry.verifier()).to.equal(v2Addr);

      // Registry still works: can submit proof via new verifier
      const nv = ethers.zeroPadValue(ethers.toBeHex(0x1a2b), 32);
      await expect(
        registry.submitProof(makeProofBytes(), nv, MERKLE_ROOT, 10n)
      ).to.emit(registry, 'PaymentConfirmed');
    });

    it('owner can transfer ownership', async () => {
      await registry.transferOwnership(stranger.address);
      expect(await registry.owner()).to.equal(stranger.address);
    });

    it('after ownership transfer, old owner cannot update verifier', async () => {
      await registry.transferOwnership(stranger.address);
      await expect(
        registry.connect(owner).updateVerifier(ethers.Wallet.createRandom().address)
      ).to.be.revertedWithCustomError(registry, 'NotOwner');
    });

    it('owner can update auditor address', async () => {
      await registry.updateAuditor(stranger.address);
      expect(await registry.auditor()).to.equal(stranger.address);
    });
  });

  // ── isSpent / isFrozen view functions ────────────────────────────────────

  describe('view functions', () => {
    it('isSpent returns false before submission', async () => {
      const nNew = ethers.zeroPadValue(ethers.toBeHex(0xffff), 32);
      expect(await registry.isSpent(nNew)).to.equal(false);
    });

    it('isFrozen returns false by default', async () => {
      expect(await registry.isFrozen(NULLIFIER)).to.equal(false);
    });
  });
});

async function latestTimestamp(): Promise<bigint> {
  const block = await ethers.provider.getBlock('latest');
  return BigInt(block!.timestamp + 1); // approximate next block timestamp
}

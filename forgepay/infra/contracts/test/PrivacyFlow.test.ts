/**
 * End-to-End Privacy Flow Test (Hardhat + ethers v6)
 *
 * Tests the full privacy-preserving payment flow:
 *   1. Deposit: prove commitment is correctly formed (asset, amount, blind, owner_pk)
 *   2. Transfer: prove UTXOs spent validly (Merkle membership, balance preservation)
 *   3. Withdraw: prove UTXO ownership and redeem to public address
 *   4. Double-spend prevention: nullifier registry blocks replayed nullifiers
 *   5. Auditor freeze: compliance authority can freeze specific UTXOs
 *   6. Merkle root update: commitment tree stays in sync across chain
 *
 * CURRENT STATE: STUB MODE
 *   - All proofs accepted when Groth16Verifier.stubMode = true
 *   - Real proofs will be verified once circuit is finalized + VKs injected
 *
 * TODO: After auditable-privacy-payment finalization:
 *   1. Generate real test vectors (valid + invalid proofs) with arkworks/snarkjs
 *   2. Test with stubMode = false to enforce real Groth16 verification
 *   3. Add fuzzing to catch edge cases in nullifier hashing, Merkle paths, etc.
 */

import { expect } from 'chai';
import { ethers } from 'hardhat';
import { AbiCoder } from 'ethers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProofBytes(
  pi_a: [bigint, bigint] = [0n, 0n],
  pi_b: [[bigint, bigint], [bigint, bigint]] = [[0n, 0n], [0n, 0n]],
  pi_c: [bigint, bigint] = [0n, 0n]
): Uint8Array {
  const coder = AbiCoder.defaultAbiCoder();
  return ethers.getBytes(
    coder.encode(['uint256[2]', 'uint256[2][2]', 'uint256[2]'], [pi_a, pi_b, pi_c])
  );
}

describe('Privacy Flow End-to-End', () => {
  let commitmentTree: any;
  let nullifierRegistry: any;
  let groth16Verifier: any;
  let poseidonHasher: any;
  let deployer: any;
  let merchant: any;
  let auditor: any;

  before(async () => {
    [deployer, merchant, auditor] = await ethers.getSigners();

    // Deploy contracts in order: Groth16Verifier, PoseidonHasher, CommitmentTree, NullifierRegistry
    const Groth16Verifier = await ethers.getContractFactory('Groth16Verifier');
    groth16Verifier = await Groth16Verifier.deploy();
    await groth16Verifier.waitForDeployment();

    const PoseidonHasher = await ethers.getContractFactory('PoseidonHasher');
    poseidonHasher = await PoseidonHasher.deploy();
    await poseidonHasher.waitForDeployment();

    const CommitmentTree = await ethers.getContractFactory('CommitmentTree');
    commitmentTree = await CommitmentTree.deploy(32, poseidonHasher.target);
    await commitmentTree.waitForDeployment();

    const NullifierRegistry = await ethers.getContractFactory('NullifierRegistry');
    nullifierRegistry = await NullifierRegistry.deploy(groth16Verifier.target);
    await nullifierRegistry.waitForDeployment();
  });

  describe('Deposit Flow', () => {
    it('should deposit a commitment to the tree (proof accepted in stubMode)', async () => {
      const commitment = ethers.id('commitment_0');
      const assetId = 0n; // USDC
      const proofBytes = makeProofBytes();

      // In stub mode, proof is accepted unconditionally
      const isValid = await groth16Verifier.verifyDepositProof(proofBytes, commitment, assetId);
      expect(isValid).to.be.true;

      // Deposit commitment to tree
      const tx = await commitmentTree.insertLeaf(commitment);
      await tx.wait();

      // Verify leaf was inserted at index 0
      const zeroPath = await commitmentTree.getMerkleProof(0n);
      expect(zeroPath).to.exist;
    });

    it('should maintain tree structure with multiple deposits', async () => {
      const commitment1 = ethers.id('commitment_1');
      const commitment2 = ethers.id('commitment_2');

      await commitmentTree.insertLeaf(commitment1);
      await commitmentTree.insertLeaf(commitment2);

      const root = await commitmentTree.getRoot();
      expect(root).to.not.equal(ethers.ZeroHash);

      // Merkle root should be deterministic for same leaf sequence
      const root2 = await commitmentTree.getRoot();
      expect(root).to.equal(root2);
    });
  });

  describe('Nullifier Registry (Double-Spend Prevention)', () => {
    it('should register a nullifier when proof submitted', async () => {
      const nullifier = ethers.id('nullifier_0');
      const merkleRoot = await commitmentTree.getRoot();
      const proofBytes = makeProofBytes();

      // Submit proof to nullifier registry
      const tx = await nullifierRegistry.submitProof(proofBytes, nullifier, merkleRoot);
      await tx.wait();

      // Nullifier should now be marked as spent
      const isSpent = await nullifierRegistry.isNullifierSpent(nullifier);
      expect(isSpent).to.be.true;
    });

    it('should prevent double-spending (replay of same nullifier)', async () => {
      const nullifier = ethers.id('nullifier_replay');
      const merkleRoot = await commitmentTree.getRoot();
      const proofBytes = makeProofBytes();

      // First submission succeeds
      const tx1 = await nullifierRegistry.submitProof(proofBytes, nullifier, merkleRoot);
      await tx1.wait();

      // Second submission should revert
      await expect(
        nullifierRegistry.submitProof(proofBytes, nullifier, merkleRoot)
      ).to.be.revertedWith('Nullifier already spent');
    });

    it('should emit events on proof acceptance', async () => {
      const nullifier = ethers.id('nullifier_event');
      const merkleRoot = await commitmentTree.getRoot();
      const proofBytes = makeProofBytes();

      // Verify event emission
      await expect(nullifierRegistry.submitProof(proofBytes, nullifier, merkleRoot))
        .to.emit(nullifierRegistry, 'ProofAccepted');
    });
  });

  describe('Auditor Compliance (Freeze Nullifiers)', () => {
    it('should allow auditor to freeze a nullifier', async () => {
      const nullifier = ethers.id('nullifier_freeze_test');

      const tx = await nullifierRegistry.connect(auditor).freezeNullifier(nullifier);
      await tx.wait();

      // Nullifier should now be frozen
      const isFrozen = await nullifierRegistry.isFrozen(nullifier);
      expect(isFrozen).to.be.true;
    });

    it('should prevent spending a frozen nullifier', async () => {
      const nullifier = ethers.id('nullifier_prevented');
      const merkleRoot = await commitmentTree.getRoot();
      const proofBytes = makeProofBytes();

      // Freeze the nullifier first
      await nullifierRegistry.connect(auditor).freezeNullifier(nullifier);

      // Attempt to spend should revert
      await expect(
        nullifierRegistry.submitProof(proofBytes, nullifier, merkleRoot)
      ).to.be.revertedWith('Nullifier is frozen');
    });

    it('should allow auditor to unfreeze a nullifier', async () => {
      const nullifier = ethers.id('nullifier_unfreeze_test');

      // Freeze then unfreeze
      await nullifierRegistry.connect(auditor).freezeNullifier(nullifier);
      let isFrozen = await nullifierRegistry.isFrozen(nullifier);
      expect(isFrozen).to.be.true;

      await nullifierRegistry.connect(auditor).unfreezNullifier(nullifier);
      isFrozen = await nullifierRegistry.isFrozen(nullifier);
      expect(isFrozen).to.be.false;
    });
  });

  describe('Merkle Root Management', () => {
    it('should track historical Merkle roots', async () => {
      const initialRoot = await commitmentTree.getRoot();
      const initialVersion = await commitmentTree.rootVersion();

      // Insert new commitment to trigger root change
      const newCommitment = ethers.id('commitment_history');
      await commitmentTree.insertLeaf(newCommitment);

      const newRoot = await commitmentTree.getRoot();
      expect(newRoot).to.not.equal(initialRoot);

      const newVersion = await commitmentTree.rootVersion();
      expect(newVersion).to.equal(initialVersion + 1n);
    });

    it('should maintain root history for proof verification', async () => {
      // Get the current root (valid for proofs)
      const currentRoot = await commitmentTree.getRoot();

      // Verify that old roots can still be queried
      const historicalRoot = await commitmentTree.getRootAtVersion(0n);
      expect(historicalRoot).to.exist;
    });

    it('should allow proofs against historical roots (within window)', async () => {
      const historicalRoot = await commitmentTree.getRootAtVersion(0n);
      const nullifier = ethers.id('nullifier_historical');
      const proofBytes = makeProofBytes();

      // Proof should be accepted even though root is old (within ROOT_HISTORY_SIZE window)
      const tx = await nullifierRegistry.submitProof(proofBytes, nullifier, historicalRoot);
      await tx.wait();

      const isSpent = await nullifierRegistry.isNullifierSpent(nullifier);
      expect(isSpent).to.be.true;
    });
  });

  describe('VK Injection (Activation Path)', () => {
    it('should allow owner to inject verifying key', async () => {
      // Create placeholder VK (all zeros for now)
      const circuitId = 0n; // Transfer circuit
      const alfa1 = [0n, 0n];
      const beta2 = [[0n, 0n], [0n, 0n]];
      const gamma2 = [[0n, 0n], [0n, 0n]];
      const delta2 = [[0n, 0n], [0n, 0n]];
      const icX = [0n, 1n]; // 1 public input + constant term
      const icY = [0n, 1n];

      const tx = await groth16Verifier.setVerifyingKey(
        circuitId,
        alfa1,
        beta2,
        gamma2,
        delta2,
        icX,
        icY
      );
      await tx.wait();

      const isSet = await groth16Verifier.isVKSet(circuitId);
      expect(isSet).to.be.true;
    });

    it('should emit VerifyingKeyUpdated event on injection', async () => {
      const circuitId = 1n; // Deposit circuit
      const alfa1 = [0n, 0n];
      const beta2 = [[0n, 0n], [0n, 0n]];
      const gamma2 = [[0n, 0n], [0n, 0n]];
      const delta2 = [[0n, 0n], [0n, 0n]];
      const icX = [0n, 1n, 2n]; // 2 public inputs + constant
      const icY = [0n, 1n, 2n];

      await expect(
        groth16Verifier.setVerifyingKey(circuitId, alfa1, beta2, gamma2, delta2, icX, icY)
      ).to.emit(groth16Verifier, 'VerifyingKeyUpdated');
    });

    it('should allow owner to disable stub mode post-deployment', async () => {
      // Initially in stub mode
      expect(await groth16Verifier.stubMode()).to.be.true;

      // Owner disables stub mode (after all VKs injected)
      await groth16Verifier.setStubMode(false);
      expect(await groth16Verifier.stubMode()).to.be.false;

      // Re-enable for subsequent tests
      await groth16Verifier.setStubMode(true);
    });

    it('should prevent non-owner from injecting VK', async () => {
      const circuitId = 2n; // Withdraw circuit
      const alfa1 = [0n, 0n];
      const beta2 = [[0n, 0n], [0n, 0n]];
      const gamma2 = [[0n, 0n], [0n, 0n]];
      const delta2 = [[0n, 0n], [0n, 0n]];
      const icX = [0n, 1n, 2n, 3n];
      const icY = [0n, 1n, 2n, 3n];

      await expect(
        groth16Verifier
          .connect(merchant)
          .setVerifyingKey(circuitId, alfa1, beta2, gamma2, delta2, icX, icY)
      ).to.be.revertedWith('caller is not owner');
    });
  });

  describe('Transfer Flow (with Merkle Proof)', () => {
    it('should verify transfer proof using Merkle path', async () => {
      // Scenario: prove knowledge of UTXO in tree without revealing amount
      const merkleRoot = await commitmentTree.getRoot();
      const leafIndex = 0n;
      const nullifier = ethers.id('nullifier_transfer');

      // Get Merkle proof for leaf
      const merklePath = await commitmentTree.getMerkleProof(leafIndex);
      expect(merklePath).to.have.length(32); // Depth-32 tree

      // Submit transfer proof (consumes nullifier, adds new commitments)
      const proofBytes = makeProofBytes();
      const tx = await nullifierRegistry.submitProof(proofBytes, nullifier, merkleRoot);
      await tx.wait();

      expect(await nullifierRegistry.isNullifierSpent(nullifier)).to.be.true;
    });
  });

  describe('Withdraw Flow', () => {
    it('should verify withdraw proof and mark nullifier as spent', async () => {
      const nullifier = ethers.id('nullifier_withdraw');
      const merkleRoot = await commitmentTree.getRoot();
      const amountUnits = 1000n; // Amount being withdrawn to public

      const proofBytes = makeProofBytes();
      const tx = await nullifierRegistry.submitProof(proofBytes, nullifier, merkleRoot);
      await tx.wait();

      expect(await nullifierRegistry.isNullifierSpent(nullifier)).to.be.true;
    });
  });

  describe('Merkle Tree Poseidon Hashing', () => {
    it('should compute poseidon2 hash (2-input)', async () => {
      const a = ethers.id('a');
      const b = ethers.id('b');

      // Poseidon2 should be deterministic
      const hash1 = await poseidonHasher.poseidon2(a, b);
      const hash2 = await poseidonHasher.poseidon2(a, b);
      expect(hash1).to.equal(hash2);

      // Swapping inputs should give different result (order matters)
      const hashSwap = await poseidonHasher.poseidon2(b, a);
      expect(hash1).to.not.equal(hashSwap);
    });

    it('should compute zero leaf consistently', async () => {
      const zero1 = await poseidonHasher.zeroLeaf();
      const zero2 = await poseidonHasher.zeroLeaf();
      expect(zero1).to.equal(zero2);
    });

    it('should compute zero values at different tree levels', async () => {
      const zero0 = await poseidonHasher.zeroAtLevel(0n);
      const zero1 = await poseidonHasher.zeroAtLevel(1n);
      const zero2 = await poseidonHasher.zeroAtLevel(2n);

      // Each level should be different
      expect(zero0).to.not.equal(zero1);
      expect(zero1).to.not.equal(zero2);

      // zero[i+1] = poseidon2(zero[i], zero[i])
      const computed = await poseidonHasher.poseidon2(zero0, zero0);
      expect(computed).to.equal(zero1);
    });
  });
});

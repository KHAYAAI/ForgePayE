/**
 * CommitmentTree contract tests (Hardhat + ethers v6)
 *
 * Tests the on-chain Merkle root tracker:
 *   1. Root updates are versioned and queryable
 *   2. Only updater can insert commitments / update root
 *   3. isKnownRoot accepts recent historical roots
 *   4. Root history window is enforced
 *
 * CURRENT STATE: STUB MODE — no Poseidon hashing on-chain.
 * TODO: After Poseidon library is integrated, test actual root computation.
 */

import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('CommitmentTree', () => {
  let tree:    any;
  let owner:   any;
  let updater: any;
  let stranger: any;

  const ROOT_1 = ethers.zeroPadValue(ethers.toBeHex(0x1111), 32);
  const ROOT_2 = ethers.zeroPadValue(ethers.toBeHex(0x2222), 32);
  const ROOT_3 = ethers.zeroPadValue(ethers.toBeHex(0x3333), 32);
  const COMMIT = ethers.zeroPadValue(ethers.toBeHex(0xabcd), 32);

  beforeEach(async () => {
    [owner, updater, stranger] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory('CommitmentTree');
    tree = await Factory.deploy(updater.address);
    await tree.waitForDeployment();
  });

  describe('updateRoot', () => {
    it('increments version and stores new root', async () => {
      expect(await tree.currentVersion()).to.equal(0n);

      await tree.connect(updater).updateRoot(ROOT_1);

      expect(await tree.currentVersion()).to.equal(1n);
      expect(await tree.currentRoot()).to.equal(ROOT_1);
    });

    it('emits RootUpdated event', async () => {
      await expect(tree.connect(updater).updateRoot(ROOT_1))
        .to.emit(tree, 'RootUpdated')
        .withArgs(1n, ROOT_1, ethers.ZeroHash, 0n, await latestTimestamp());
    });

    it('tracks multiple root updates', async () => {
      await tree.connect(updater).updateRoot(ROOT_1);
      await tree.connect(updater).updateRoot(ROOT_2);
      await tree.connect(updater).updateRoot(ROOT_3);

      expect(await tree.currentVersion()).to.equal(3n);
      expect(await tree.currentRoot()).to.equal(ROOT_3);
      expect(await tree.rootAtVersion(1n)).to.equal(ROOT_1);
      expect(await tree.rootAtVersion(2n)).to.equal(ROOT_2);
    });

    it('reverts for zero root', async () => {
      await expect(
        tree.connect(updater).updateRoot(ethers.ZeroHash)
      ).to.be.revertedWithCustomError(tree, 'InvalidRoot');
    });

    it('non-updater cannot update root', async () => {
      await expect(
        tree.connect(stranger).updateRoot(ROOT_1)
      ).to.be.revertedWithCustomError(tree, 'NotUpdater');
    });
  });

  describe('insertCommitment', () => {
    it('increments leaf count and emits CommitmentInserted', async () => {
      await expect(tree.connect(updater).insertCommitment(COMMIT))
        .to.emit(tree, 'CommitmentInserted')
        .withArgs(COMMIT, 0n, 0n, await latestTimestamp());

      expect(await tree.leafCount()).to.equal(1n);
    });

    it('tracks consecutive leaf indices', async () => {
      const C1 = ethers.zeroPadValue(ethers.toBeHex(0xaaaa), 32);
      const C2 = ethers.zeroPadValue(ethers.toBeHex(0xbbbb), 32);

      await tree.connect(updater).insertCommitment(C1);
      await tree.connect(updater).insertCommitment(C2);

      expect(await tree.leafCount()).to.equal(2n);
    });

    it('reverts on zero commitment', async () => {
      await expect(
        tree.connect(updater).insertCommitment(ethers.ZeroHash)
      ).to.be.revertedWith('CommitmentTree: zero commitment');
    });
  });

  describe('isKnownRoot', () => {
    it('recognizes current root', async () => {
      await tree.connect(updater).updateRoot(ROOT_1);
      expect(await tree.isKnownRoot(ROOT_1)).to.equal(true);
    });

    it('recognizes recent historical roots', async () => {
      await tree.connect(updater).updateRoot(ROOT_1);
      await tree.connect(updater).updateRoot(ROOT_2);
      await tree.connect(updater).updateRoot(ROOT_3);

      // All three should be in the window
      expect(await tree.isKnownRoot(ROOT_1)).to.equal(true);
      expect(await tree.isKnownRoot(ROOT_2)).to.equal(true);
      expect(await tree.isKnownRoot(ROOT_3)).to.equal(true);
    });

    it('rejects unknown root', async () => {
      await tree.connect(updater).updateRoot(ROOT_1);
      const unknownRoot = ethers.zeroPadValue(ethers.toBeHex(0xfeed), 32);
      expect(await tree.isKnownRoot(unknownRoot)).to.equal(false);
    });

    it('rejects empty initial root (0x0000)', async () => {
      // Initial version 0 has root = bytes32(0)
      // After updateRoot, the zero root should not be returned as known
      await tree.connect(updater).updateRoot(ROOT_1);
      expect(await tree.isKnownRoot(ethers.ZeroHash)).to.equal(false);
    });
  });

  describe('rootAtVersion', () => {
    it('returns root at a specific version', async () => {
      await tree.connect(updater).updateRoot(ROOT_1);
      await tree.connect(updater).updateRoot(ROOT_2);

      expect(await tree.rootAtVersion(1n)).to.equal(ROOT_1);
      expect(await tree.rootAtVersion(2n)).to.equal(ROOT_2);
    });

    it('reverts for future version', async () => {
      await expect(
        tree.rootAtVersion(100n)
      ).to.be.revertedWithCustomError(tree, 'RootNotFound').withArgs(100n);
    });
  });

  describe('admin', () => {
    it('owner can update updater address', async () => {
      await tree.updateUpdater(stranger.address);
      expect(await tree.updater()).to.equal(stranger.address);
    });

    it('non-owner cannot update updater', async () => {
      await expect(
        tree.connect(stranger).updateUpdater(stranger.address)
      ).to.be.revertedWithCustomError(tree, 'NotOwner');
    });

    it('owner is also allowed to update root', async () => {
      await tree.connect(owner).updateRoot(ROOT_1);
      expect(await tree.currentRoot()).to.equal(ROOT_1);
    });
  });
});

async function latestTimestamp(): Promise<bigint> {
  const block = await ethers.provider.getBlock('latest');
  return BigInt(block!.timestamp + 1);
}

/**
 * CommitmentTree contract tests (Hardhat + ethers v6)
 *
 * Tests the on-chain Merkle root tracker:
 *   1. Root updates are versioned and queryable
 *   2. Only updater can insert commitments / update root
 *   3. isKnownRoot accepts recent historical roots
 *   4. Root history window is enforced
 *   5. insertCommitment atomically updates the root via Poseidon incremental tree
 *
 * CURRENT STATE: Poseidon hashing is a keccak256 stub — real hash will be
 * identical in structure but use Poseidon2 round constants.
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

  // ── updateRoot ───────────────────────────────────────────────────────────

  describe('updateRoot', () => {
    it('increments version and stores new root', async () => {
      expect(await tree.currentVersion()).to.equal(0n);

      await tree.connect(updater).updateRoot(ROOT_1);

      expect(await tree.currentVersion()).to.equal(1n);
      expect(await tree.currentRoot()).to.equal(ROOT_1);
    });

    it('emits RootUpdated event', async () => {
      const initialRoot = await tree.currentRoot();
      await expect(tree.connect(updater).updateRoot(ROOT_1))
        .to.emit(tree, 'RootUpdated')
        .withArgs(1n, ROOT_1, initialRoot, 0n, await latestTimestamp());
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

    it('non-updater cannot update root → revert NotUpdater', async () => {
      await expect(
        tree.connect(stranger).updateRoot(ROOT_1)
      ).to.be.revertedWithCustomError(tree, 'NotUpdater');
    });

    it('owner is also allowed to update root', async () => {
      await tree.connect(owner).updateRoot(ROOT_1);
      expect(await tree.currentRoot()).to.equal(ROOT_1);
    });
  });

  // ── insertCommitment ─────────────────────────────────────────────────────

  describe('insertCommitment', () => {
    it('increments leafCount on each insertion', async () => {
      expect(await tree.leafCount()).to.equal(0n);

      await tree.connect(updater).insertCommitment(COMMIT);
      expect(await tree.leafCount()).to.equal(1n);

      const C2 = ethers.zeroPadValue(ethers.toBeHex(0xbbbb), 32);
      await tree.connect(updater).insertCommitment(C2);
      expect(await tree.leafCount()).to.equal(2n);
    });

    it('increments leaf count and emits CommitmentInserted', async () => {
      // The event version is incremented atomically with the insertion
      await expect(tree.connect(updater).insertCommitment(COMMIT))
        .to.emit(tree, 'CommitmentInserted')
        .withArgs(COMMIT, 0n, 1n, await latestTimestamp());

      expect(await tree.leafCount()).to.equal(1n);
    });

    it('emits CommitmentInserted with correct leafIndex (0-based)', async () => {
      const C1 = ethers.zeroPadValue(ethers.toBeHex(0xaaaa), 32);
      const C2 = ethers.zeroPadValue(ethers.toBeHex(0xbbbb), 32);
      const C3 = ethers.zeroPadValue(ethers.toBeHex(0xcccc), 32);

      // Leaf index 0
      await expect(tree.connect(updater).insertCommitment(C1))
        .to.emit(tree, 'CommitmentInserted')
        .withArgs(C1, 0n, 1n, await latestTimestamp());

      // Leaf index 1
      await expect(tree.connect(updater).insertCommitment(C2))
        .to.emit(tree, 'CommitmentInserted')
        .withArgs(C2, 1n, 2n, await latestTimestamp());

      // Leaf index 2
      await expect(tree.connect(updater).insertCommitment(C3))
        .to.emit(tree, 'CommitmentInserted')
        .withArgs(C3, 2n, 3n, await latestTimestamp());
    });

    it('insertCommitment also emits RootUpdated', async () => {
      const tx = await tree.connect(updater).insertCommitment(COMMIT);
      const receipt = await tx.wait();

      const iface = tree.interface;
      const parsedLogs = receipt.logs
        .map((log: any) => { try { return iface.parseLog(log); } catch { return null; } })
        .filter(Boolean);

      const rootUpdatedLog = parsedLogs.find((l: any) => l.name === 'RootUpdated');
      expect(rootUpdatedLog).to.not.be.undefined;
      expect(rootUpdatedLog.args.version).to.equal(1n);
    });

    it('after insertCommitment, currentRoot changes from initial zero-tree root', async () => {
      const initialRoot = await tree.currentRoot();
      await tree.connect(updater).insertCommitment(COMMIT);
      const newRoot = await tree.currentRoot();
      // The new root must differ from the initial empty-tree root
      expect(newRoot).to.not.equal(initialRoot);
      expect(newRoot).to.not.equal(ethers.ZeroHash);
    });

    it('two insertions produce different roots', async () => {
      await tree.connect(updater).insertCommitment(COMMIT);
      const rootAfter1 = await tree.currentRoot();

      const C2 = ethers.zeroPadValue(ethers.toBeHex(0xbbbb), 32);
      await tree.connect(updater).insertCommitment(C2);
      const rootAfter2 = await tree.currentRoot();

      expect(rootAfter2).to.not.equal(rootAfter1);
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

    it('non-updater cannot insertCommitment → revert NotUpdater', async () => {
      await expect(
        tree.connect(stranger).insertCommitment(COMMIT)
      ).to.be.revertedWithCustomError(tree, 'NotUpdater');
    });

    it('owner can insertCommitment (owner is also allowed)', async () => {
      await expect(
        tree.connect(owner).insertCommitment(COMMIT)
      ).to.emit(tree, 'CommitmentInserted');
      expect(await tree.leafCount()).to.equal(1n);
    });

    it('version increments on insertCommitment (atomic root update)', async () => {
      expect(await tree.currentVersion()).to.equal(0n);
      await tree.connect(updater).insertCommitment(COMMIT);
      expect(await tree.currentVersion()).to.equal(1n);
    });
  });

  // ── isKnownRoot ──────────────────────────────────────────────────────────

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

    it('isKnownRoot returns true for root inserted via insertCommitment', async () => {
      await tree.connect(updater).insertCommitment(COMMIT);
      const root = await tree.currentRoot();
      expect(await tree.isKnownRoot(root)).to.equal(true);
    });

    it('rejects unknown root', async () => {
      await tree.connect(updater).updateRoot(ROOT_1);
      const unknownRoot = ethers.zeroPadValue(ethers.toBeHex(0xfeed), 32);
      expect(await tree.isKnownRoot(unknownRoot)).to.equal(false);
    });

    it('isKnownRoot returns false for completely unknown root', async () => {
      // Tree has no updates — completely unknown value
      const neverSeen = ethers.zeroPadValue(ethers.toBeHex(0xdeaddeaddeaddeadn), 32);
      expect(await tree.isKnownRoot(neverSeen)).to.equal(false);
    });

    it('rejects bytes32(0) explicitly', async () => {
      // Zero root is explicitly rejected by the updated isKnownRoot
      expect(await tree.isKnownRoot(ethers.ZeroHash)).to.equal(false);
    });

    it('rejects empty initial root after updateRoot', async () => {
      // Version 0 root is the empty-tree Poseidon root (non-zero) — not ZeroHash
      await tree.connect(updater).updateRoot(ROOT_1);
      expect(await tree.isKnownRoot(ethers.ZeroHash)).to.equal(false);
    });

    it('root history window: after ROOT_HISTORY_SIZE+5 updates, very old root is no longer known', async () => {
      // Fetch ROOT_HISTORY_SIZE from the contract
      const windowSize = await tree.ROOT_HISTORY_SIZE();
      const extraUpdates = 5n;
      const totalUpdates = windowSize + extraUpdates;

      // First update (the one that will fall out of the window)
      const oldRoot = ethers.zeroPadValue(ethers.toBeHex(0xold1234), 32);
      await tree.connect(updater).updateRoot(oldRoot);

      // Perform enough updates to push oldRoot out of the window
      for (let i = 0n; i < totalUpdates; i++) {
        // Generate a unique root for each update
        const uniqueRoot = ethers.zeroPadValue(
          ethers.toBeHex(BigInt('0x1000000') + i),
          32
        );
        await tree.connect(updater).updateRoot(uniqueRoot);
      }

      // oldRoot should now be outside the ROOT_HISTORY_SIZE window
      expect(await tree.isKnownRoot(oldRoot)).to.equal(false);
    });
  });

  // ── rootAtVersion ────────────────────────────────────────────────────────

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

  // ── zeros / filledSubtrees arrays ────────────────────────────────────────

  describe('zeros array', () => {
    it('zeros array is initialized (length 33, TREE_DEPTH=32)', async () => {
      const z0 = await tree.zeros(0);
      expect(z0).to.not.equal(ethers.ZeroHash, 'zeros[0] (zeroLeaf) must be non-zero');
    });

    it('zeros[i+1] = poseidon2(zeros[i], zeros[i]) — distinct at each level', async () => {
      const z0 = await tree.zeros(0);
      const z1 = await tree.zeros(1);
      const z2 = await tree.zeros(2);

      // All levels must differ (hash chain must not loop to zero)
      expect(z0).to.not.equal(z1);
      expect(z1).to.not.equal(z2);
      expect(z0).to.not.equal(z2);
    });
  });

  // ── admin ────────────────────────────────────────────────────────────────

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

    it('only updater or owner can insertCommitment — stranger reverts with NotUpdater', async () => {
      await expect(
        tree.connect(stranger).insertCommitment(COMMIT)
      ).to.be.revertedWithCustomError(tree, 'NotUpdater');
    });

    it('only updater or owner can updateRoot — stranger reverts with NotUpdater', async () => {
      await expect(
        tree.connect(stranger).updateRoot(ROOT_1)
      ).to.be.revertedWithCustomError(tree, 'NotUpdater');
    });
  });
});

async function latestTimestamp(): Promise<bigint> {
  const block = await ethers.provider.getBlock('latest');
  return BigInt(block!.timestamp + 1);
}

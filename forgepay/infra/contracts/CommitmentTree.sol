// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

import "./PoseidonHasher.sol";

/**
 * @title CommitmentTree
 * @notice On-chain incremental Merkle tree for UTXO commitments.
 *
 * ARCH: The Merkle tree holds all UTXO commitments in sorted order.
 * The root changes whenever a new commitment is inserted (deposit or transfer output).
 * Provers generate Merkle membership proofs off-chain and verify them in the Transfer circuit.
 *
 * This contract:
 *   1. Maintains an incremental Merkle tree with Poseidon hashing (stub: keccak).
 *   2. Stores a versioned history of Merkle roots.
 *   3. Allows the unified-router to insert commitments and update the root atomically.
 *   4. Allows anyone to verify that a historical root was valid at a given version.
 *
 * Why versioned? Old proofs reference older roots. Provers may have started generating
 * a proof with version N, but by the time they submit it, the tree has been updated to
 * version N+5. We need to accept proofs against any recent root (within a window).
 *
 * Incremental Merkle tree (tornado-cash / semaphore style):
 *   - Tree depth = TREE_DEPTH (32), supports 2^32 ≈ 4B commitments.
 *   - filledSubtrees[i] = hash of the rightmost complete subtree at level i.
 *   - zeros[i] = hash of an empty subtree of height i (pre-computed in constructor).
 *   - Insertion walks up from the leaf, updating filledSubtrees at each level.
 *
 * Access Control:
 *   - Only authorized updater (unified-router, Kubernetes service account) can
 *     insertCommitment or updateRoot.
 *   - Owner can change updater, transfer ownership.
 *   - Anyone can read roots and verify membership.
 *
 * Hash function:
 *   - PoseidonHasher.poseidon2 for internal nodes.
 *   - PoseidonHasher.poseidon1 for leaf hashing (applied to raw commitments).
 *   - STUB: Currently uses keccak256 domain-separated placeholders.
 *     Replace PoseidonHasher with real constants after circuit finalization.
 */
contract CommitmentTree {
    using PoseidonHasher for *;

    // ── Constants ─────────────────────────────────────────────────────────────

    /// @notice Maximum depth of the Merkle tree (supports 2^32 = ~4B commitments)
    uint256 public constant TREE_DEPTH = 32;

    /// @notice Root validity window (proofs against last N roots are accepted)
    uint256 public constant ROOT_HISTORY_SIZE = 30;

    // ── State ─────────────────────────────────────────────────────────────────

    /// @notice Owner (ForgePay operations key)
    address public owner;

    /// @notice Authorized updater (unified-router service account)
    address public updater;

    /// @notice Current version (increments on each root update)
    uint256 public currentVersion;

    /// @notice Mapping: version → Merkle root hash
    mapping(uint256 => bytes32) public roots;

    /// @notice Number of commitments in the tree
    uint256 public leafCount;

    /// @notice Pre-computed zero value at each tree level (index 0 = leaf level).
    /// zeros[i+1] = poseidon2(zeros[i], zeros[i])
    bytes32[33] public zeros;

    /// @notice Current right-most filled subtree hash at each level.
    /// Updated on each insertCommitment call.
    bytes32[33] public filledSubtrees;

    // ── Events ────────────────────────────────────────────────────────────────

    /**
     * @dev Emitted when the Merkle root is updated.
     * Indexed by version so chain-sync can detect changes efficiently.
     */
    event RootUpdated(
        uint256 indexed version,
        bytes32 indexed newRoot,
        bytes32 indexed prevRoot,
        uint256 leafCount,
        uint256 timestamp
    );

    /**
     * @dev Emitted when a commitment is inserted (deposit or transfer output).
     */
    event CommitmentInserted(
        bytes32 indexed commitment,
        uint256 indexed leafIndex,
        uint256 indexed version,
        uint256 timestamp
    );

    // ── Errors ────────────────────────────────────────────────────────────────

    error NotOwner();
    error NotUpdater();
    error InvalidRoot();
    error RootNotFound(uint256 version);
    error TreeFull();

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _updater) {
        owner   = msg.sender;
        updater = _updater;

        // Pre-compute zero values for each level of the Merkle tree.
        // zeros[0]   = PoseidonHasher.zeroLeaf()
        // zeros[i+1] = poseidon2(zeros[i], zeros[i])
        zeros[0] = PoseidonHasher.zeroLeaf();
        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            zeros[i + 1] = PoseidonHasher.poseidon2(zeros[i], zeros[i]);
        }

        // Initialize filledSubtrees with zero values
        for (uint256 i = 0; i <= TREE_DEPTH; i++) {
            filledSubtrees[i] = zeros[i];
        }

        // Initialize with empty root (version 0)
        roots[0] = zeros[TREE_DEPTH];
        currentVersion = 0;
    }

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyUpdater() {
        if (msg.sender != updater && msg.sender != owner) revert NotUpdater();
        _;
    }

    // ── Core Functions ────────────────────────────────────────────────────────

    /**
     * @notice Insert a commitment into the Merkle tree.
     *
     * Called by ForgePay's unified-router after a valid deposit proof is verified.
     * Atomically updates the incremental Merkle tree and stores the new root.
     *
     * @param commitment The commitment hash to insert (Poseidon(asset, amount, blind, owner))
     *
     * HASH FUNCTION: Uses PoseidonHasher.poseidon2 for internal nodes.
     * STUB: Currently uses keccak256 domain-separated placeholders.
     */
    function insertCommitment(bytes32 commitment) external onlyUpdater {
        require(commitment != bytes32(0), "CommitmentTree: zero commitment");

        uint256 leafIndex = leafCount;
        if (leafIndex >= (1 << TREE_DEPTH)) revert TreeFull();

        bytes32 newRoot = _insertLeaf(commitment, leafIndex);

        leafCount++;

        // Increment version and store new root atomically
        bytes32 prevRoot = roots[currentVersion];
        currentVersion++;
        roots[currentVersion] = newRoot;

        emit CommitmentInserted(
            commitment,
            leafIndex,
            currentVersion,
            block.timestamp
        );

        emit RootUpdated(
            currentVersion,
            newRoot,
            prevRoot,
            leafCount,
            block.timestamp
        );
    }

    /**
     * @notice Compute the new Merkle root after inserting a leaf.
     *
     * Incremental Merkle tree insertion:
     *   1. Hash the raw commitment to get the leaf node.
     *   2. Walk up the tree: at each level, if this is a left child (even index),
     *      save the current node in filledSubtrees[level] and pair with zeros[level].
     *      If it's a right child (odd index), pair with filledSubtrees[level].
     *   3. Return the root after TREE_DEPTH levels.
     *
     * @param commitment Raw commitment bytes32
     * @param leafIndex  The index of the new leaf (0-based)
     * @return newRoot   The new Merkle root
     */
    function _insertLeaf(bytes32 commitment, uint256 leafIndex)
        internal
        returns (bytes32 newRoot)
    {
        // Hash the commitment to produce the leaf node value
        bytes32 currentNode = PoseidonHasher.poseidon1(commitment);

        uint256 currentIndex = leafIndex;

        for (uint256 level = 0; level < TREE_DEPTH; level++) {
            bytes32 left;
            bytes32 right;

            if (currentIndex % 2 == 0) {
                // Current node is the left child: save it, pair with zero on right
                left  = currentNode;
                right = zeros[level];
                filledSubtrees[level] = currentNode;
            } else {
                // Current node is the right child: pair with previously filled left sibling
                left  = filledSubtrees[level];
                right = currentNode;
            }

            currentNode  = PoseidonHasher.poseidon2(left, right);
            currentIndex = currentIndex / 2;
        }

        newRoot = currentNode;
    }

    /**
     * @notice Update the Merkle root after off-chain computation.
     *
     * @dev DEPRECATED — prefer insertCommitment which updates the root atomically.
     * Kept for backward compatibility with the unified-router's current off-chain
     * root computation flow. Will be removed once all services migrate to
     * on-chain incremental insertion.
     *
     * Called by the unified-router service after computing the new root
     * from the off-chain Merkle tree (Rust, using Poseidon hash).
     *
     * @param newRoot The new Merkle root hash
     */
    function updateRoot(bytes32 newRoot) external onlyUpdater {
        if (newRoot == bytes32(0)) revert InvalidRoot();

        bytes32 prevRoot = roots[currentVersion];
        currentVersion++;
        roots[currentVersion] = newRoot;

        emit RootUpdated(
            currentVersion,
            newRoot,
            prevRoot,
            leafCount,
            block.timestamp
        );
    }

    // ── Root Queries ──────────────────────────────────────────────────────────

    /**
     * @notice Get the current Merkle root.
     * @return root The current root hash
     */
    function currentRoot() external view returns (bytes32 root) {
        return roots[currentVersion];
    }

    /**
     * @notice Get the Merkle root at a specific version.
     * @param version The version to query
     * @return root The root hash at that version
     */
    function rootAtVersion(uint256 version) external view returns (bytes32 root) {
        if (version > currentVersion) revert RootNotFound(version);
        return roots[version];
    }

    /**
     * @notice Check if a given root is in the recent history window.
     *
     * Provers may reference older roots. This function checks that the root
     * is within ROOT_HISTORY_SIZE versions of the current root.
     *
     * @param root The root to check
     * @return valid True if the root is a known valid historical root
     */
    function isKnownRoot(bytes32 root) external view returns (bool valid) {
        // Reject zero root: version 0 starts with a non-zero zero-tree root now,
        // but we keep this guard for safety.
        if (root == bytes32(0)) return false;

        uint256 start = currentVersion >= ROOT_HISTORY_SIZE
            ? currentVersion - ROOT_HISTORY_SIZE
            : 0;

        for (uint256 i = currentVersion; i >= start; i--) {
            if (roots[i] == root) return true;
            if (i == 0) break;
        }
        return false;
    }

    // ── Admin Functions ───────────────────────────────────────────────────────

    /**
     * @notice Update the authorized updater address.
     * @param newUpdater New updater address
     */
    function updateUpdater(address newUpdater) external onlyOwner {
        updater = newUpdater;
    }

    /**
     * @notice Transfer ownership to a new address (multisig recommended).
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}

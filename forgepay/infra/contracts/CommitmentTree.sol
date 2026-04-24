// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

/**
 * @title CommitmentTree
 * @notice On-chain Merkle tree root tracker for UTXO commitments.
 *
 * ARCH: The Merkle tree holds all UTXO commitments in sorted order.
 * The root changes whenever a new commitment is inserted (deposit or transfer output).
 * Provers generate Merkle membership proofs off-chain and verify them in the Transfer circuit.
 *
 * This contract:
 *   1. Stores a versioned history of Merkle roots
 *   2. Allows the unified-router to update the root (after off-chain computation)
 *   3. Allows anyone to verify that a historical root was valid at a given version
 *
 * Why versioned? Old proofs reference older roots. Provers may have started generating
 * a proof with version N, but by the time they submit it, the tree has been updated to
 * version N+5. We need to accept proofs against any recent root (within a window).
 *
 * Access Control:
 *   - Only authorized updater (unified-router, Kubernetes service account) can updateRoot
 *   - Anyone can read roots and verify membership
 *
 * CURRENT STATE: **STUBBED FOR TESTING** — updateRoot works; no Poseidon hashing.
 * Real implementation requires Poseidon hash library (circomlibjs or arkworks port).
 *
 * TODO: Implement Poseidon-based incremental Merkle tree (from auditable-privacy-payment).
 */
contract CommitmentTree {

    // ── Constants ─────────────────────────────────────────────────────────────

    /// @notice Maximum depth of the Merkle tree (2^32 = 4B commitments)
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

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _updater) {
        owner   = msg.sender;
        updater = _updater;

        // Initialize with empty root (version 0)
        roots[0] = bytes32(0);
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
     * The off-chain Merkle tree is updated, and the new root is submitted via updateRoot.
     *
     * @param commitment The commitment hash to insert (Poseidon(asset, amount, blind, owner))
     *
     * STUB: Emits event and increments counter; does NOT recompute root on-chain.
     * Real implementation uses Poseidon to compute new root incrementally.
     * TODO: Implement on-chain incremental Poseidon Merkle tree.
     */
    function insertCommitment(bytes32 commitment) external onlyUpdater {
        require(commitment != bytes32(0), "CommitmentTree: zero commitment");

        uint256 leafIndex = leafCount;
        leafCount++;

        // STUB: Root update happens separately via updateRoot
        // TODO: Compute new root inline using Poseidon hash
        // uint256 newRoot = _insertLeaf(commitment, leafIndex);
        // roots[++currentVersion] = bytes32(newRoot);

        emit CommitmentInserted(
            commitment,
            leafIndex,
            currentVersion,
            block.timestamp
        );
    }

    /**
     * @notice Update the Merkle root after off-chain computation.
     *
     * Called by the unified-router service after computing the new root
     * from the off-chain Merkle tree (Rust, using Poseidon hash).
     *
     * @param newRoot The new Merkle root hash
     *
     * STUB: Works correctly (stores root and increments version).
     * TODO: Add ZK proof that newRoot was computed correctly.
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
     *
     * STUB: Linear search over recent versions. Optimize with circular buffer.
     * TODO: Use efficient circular buffer for O(1) lookup.
     */
    function isKnownRoot(bytes32 root) external view returns (bool valid) {
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

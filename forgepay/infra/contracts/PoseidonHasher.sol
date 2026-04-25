// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

/**
 * @title PoseidonHasher
 * @notice Poseidon2 hash library for Merkle tree construction in ForgePay's
 *         privacy-preserving payment system.
 *
 * ARCH: Poseidon is the ZK-friendly hash function used inside the Groth16 circuit.
 * The on-chain Merkle tree must use the same hash function so that Merkle membership
 * proofs generated off-chain (by the prover) can be verified inside the circuit.
 *
 * STUB NOTICE:
 *   Using keccak256 as a Poseidon placeholder. Replace with circomlibjs Poseidon
 *   constants when circuit is finalized.
 *
 *   Real Poseidon2 (2-input sponge on BN254 scalar field) requires:
 *     1. Round constants: field-specific constants derived from the hash of
 *        "poseidon" over the BN254 scalar field.
 *     2. MDS matrix: a 3×3 Maximum Distance Separable matrix over Fq.
 *     3. Sponge construction: rate=2, capacity=1 (state width = 3 field elements).
 *     4. Full/partial rounds: typically 8 full + 57 partial rounds (Poseidon-128).
 *
 *   Resources:
 *     - Poseidon paper: https://eprint.iacr.org/2019/458.pdf
 *     - circomlibjs: https://github.com/iden3/circomlibjs
 *     - Reference implementation: https://github.com/iden3/go-iden3-crypto/tree/master/poseidon
 *
 * DOMAIN SEPARATORS (for the keccak stub):
 *   - poseidon2(a, b):   keccak256(abi.encode("POSEIDON2", a, b))
 *   - poseidon1(a):      keccak256(abi.encode("POSEIDON1", a))
 *
 * These separators ensure poseidon1 and poseidon2 produce different outputs
 * for the same inputs, preventing second-preimage confusion at different tree levels.
 */
library PoseidonHasher {

    // ── Domain Separators ─────────────────────────────────────────────────────

    /// @dev Domain separator for 2-input hash (poseidon2)
    bytes32 private constant DOMAIN_2 = keccak256("POSEIDON2_DOMAIN");

    /// @dev Domain separator for 1-input hash (poseidon1 / leaf hash)
    bytes32 private constant DOMAIN_1 = keccak256("POSEIDON1_DOMAIN");

    // ── Hash Functions ────────────────────────────────────────────────────────

    /**
     * @notice Compute a 2-input Poseidon hash (used for internal Merkle tree nodes).
     *
     * STUB: Using keccak256 as Poseidon placeholder. Replace with circomlibjs
     * Poseidon constants when circuit is finalized.
     *
     * Real Poseidon2 specification (BN254):
     *   state = [0, a, b]  (capacity || rate)
     *   Apply full rounds, partial rounds, full rounds with BN254-specific constants.
     *   Output = state[0] (capacity element)
     *
     * @param a Left input (bytes32 / BN254 field element)
     * @param b Right input (bytes32 / BN254 field element)
     * @return hash The Poseidon2 hash of (a, b)
     */
    function poseidon2(bytes32 a, bytes32 b) internal pure returns (bytes32 hash) {
        // STUB: keccak256 with domain separator as Poseidon placeholder.
        // TODO: Replace with actual Poseidon2 round constants from circomlibjs
        // when the auditable-privacy-payment circuit is finalized.
        hash = keccak256(abi.encode(DOMAIN_2, a, b));
    }

    /**
     * @notice Compute a 1-input Poseidon hash (used for leaf commitment hashing).
     *
     * STUB: Using keccak256 as Poseidon placeholder. Replace with circomlibjs
     * Poseidon constants when circuit is finalized.
     *
     * Real Poseidon1 specification (BN254):
     *   state = [0, a, 0]  (capacity || rate || padding)
     *   Apply full rounds, partial rounds, full rounds.
     *   Output = state[0]
     *
     * @param a Input (bytes32 / BN254 field element — the commitment)
     * @return hash The Poseidon1 hash of (a)
     */
    function poseidon1(bytes32 a) internal pure returns (bytes32 hash) {
        // STUB: keccak256 with domain separator as Poseidon placeholder.
        // TODO: Replace with actual Poseidon1 round constants from circomlibjs
        // when the auditable-privacy-payment circuit is finalized.
        hash = keccak256(abi.encode(DOMAIN_1, a));
    }

    // ── Zero Value ────────────────────────────────────────────────────────────

    /**
     * @notice Compute the canonical "empty leaf" zero value used in the Merkle tree.
     *
     * The zero leaf is defined as poseidon1(poseidon1("forgepay-zero")).
     * This gives a non-trivial constant that is safe to use as a placeholder
     * for unfilled leaves without colliding with valid commitment hashes.
     *
     * @return zeroLeaf The zero leaf hash
     */
    function zeroLeaf() internal pure returns (bytes32 zeroLeaf_) {
        // STUB: same function composition, keccak-based until real Poseidon is in.
        bytes32 inner = poseidon1(keccak256("forgepay-zero"));
        zeroLeaf_ = poseidon1(inner);
    }

    /**
     * @notice Compute the zero value at a given tree level.
     *
     * zeros[0]   = zeroLeaf()
     * zeros[i+1] = poseidon2(zeros[i], zeros[i])
     *
     * @param level The tree level (0 = leaf, TREE_DEPTH = root)
     * @return zero The zero value at that level
     */
    function zeroAtLevel(uint256 level) internal pure returns (bytes32 zero) {
        zero = zeroLeaf();
        for (uint256 i = 0; i < level; i++) {
            zero = poseidon2(zero, zero);
        }
    }
}

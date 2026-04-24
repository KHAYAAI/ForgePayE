// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

import "./Groth16Verifier.sol";

/**
 * @title NullifierRegistry
 * @notice On-chain registry of spent nullifiers (prevents double-spending).
 *
 * ARCH: Each shielded UTXO has a unique nullifier = Poseidon(commitment, secret_key).
 * When a UTXO is spent, its nullifier is revealed and stored here.
 * Any subsequent attempt to spend the same UTXO will fail (nullifier already exists).
 *
 * This contract is the canonical source of truth for "is this UTXO spent?".
 * The ForgePay chain-sync service polls this contract for new events and
 * keeps the off-chain nullifier set in PostgreSQL synchronized.
 *
 * Access Control:
 *   - Anyone can call submitProof (payment is public intent)
 *   - Only auditor can call freezeNullifier (compliance enforcement)
 *   - Owner can upgrade verifier address (via owner-gated function)
 *
 * CURRENT STATE: **STUBBED FOR TESTING** — verifier call always succeeds.
 * Deploy to testnet first; mainnet after external audit.
 */
contract NullifierRegistry {

    // ── State ─────────────────────────────────────────────────────────────────

    /// @notice Owner (ForgePay operations key, multisig in production)
    address public owner;

    /// @notice Auditor address (can freeze nullifiers for compliance)
    address public auditor;

    /// @notice Address of the Groth16 verifier contract
    address public verifier;

    /// @notice Set of spent nullifiers
    mapping(bytes32 => bool) public nullifiers;

    /// @notice Set of frozen nullifiers (auditor enforcement)
    mapping(bytes32 => bool) public frozenNullifiers;

    // ── Events ────────────────────────────────────────────────────────────────

    /**
     * @dev Emitted when a payment is confirmed (proof verified, nullifier recorded).
     * Indexed so chain-sync can efficiently filter by merchant or nullifier.
     */
    event PaymentConfirmed(
        bytes32 indexed nullifier,
        bytes32 indexed merkleRoot,
        address indexed caller,
        uint256 amountUnits,
        uint256 timestamp
    );

    /**
     * @dev Emitted when auditor freezes a nullifier (sanctions/fraud enforcement).
     */
    event NullifierFrozen(
        bytes32 indexed nullifier,
        address indexed auditor,
        string reason,
        uint256 timestamp
    );

    /**
     * @dev Emitted when verifier address is updated (contract upgrade path).
     */
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    // ── Errors ────────────────────────────────────────────────────────────────

    error NotOwner();
    error NotAuditor();
    error NullifierAlreadySpent(bytes32 nullifier);
    error NullifierFrozenError(bytes32 nullifier);
    error ProofVerificationFailed();
    error InvalidNullifier();

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _verifier, address _auditor) {
        owner    = msg.sender;
        verifier = _verifier;
        auditor  = _auditor;
    }

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuditor() {
        if (msg.sender != auditor) revert NotAuditor();
        _;
    }

    // ── Core Functions ────────────────────────────────────────────────────────

    /**
     * @notice Submit a Groth16 proof to confirm a shielded payment.
     *
     * Flow:
     *   1. Verify proof using Groth16Verifier
     *   2. Check nullifier not already spent
     *   3. Check nullifier not frozen by auditor
     *   4. Record nullifier as spent
     *   5. Emit PaymentConfirmed event
     *
     * @param proofBytes Serialized Groth16 proof (pi_a, pi_b, pi_c on BN254)
     * @param nullifier The nullifier being consumed (Poseidon(commitment, sk))
     * @param merkleRoot The Merkle tree root commitment was included in
     * @param amountUnits Amount being transferred (public, for settlement)
     *
     * @dev nullifier must not be bytes32(0) (reserved as "empty")
     *
     * STUB: Groth16Verifier.verifyProof always returns true in testing mode.
     * TODO: When real verifier is deployed, this will fail for invalid proofs.
     */
    function submitProof(
        bytes calldata proofBytes,
        bytes32 nullifier,
        bytes32 merkleRoot,
        uint256 amountUnits
    ) external {
        if (nullifier == bytes32(0)) revert InvalidNullifier();
        if (nullifiers[nullifier]) revert NullifierAlreadySpent(nullifier);
        if (frozenNullifiers[nullifier]) revert NullifierFrozenError(nullifier);

        // Verify Groth16 proof via external verifier contract
        // Public inputs: [merkleRoot, nullifier, amountUnits]
        uint256[] memory publicInputs = new uint256[](3);
        publicInputs[0] = uint256(merkleRoot);
        publicInputs[1] = uint256(nullifier);
        publicInputs[2] = amountUnits;

        bool valid = Groth16Verifier(verifier).verifyProof(proofBytes, publicInputs);
        if (!valid) revert ProofVerificationFailed();

        // Record nullifier as spent (prevents double-spending)
        nullifiers[nullifier] = true;

        emit PaymentConfirmed(
            nullifier,
            merkleRoot,
            msg.sender,
            amountUnits,
            block.timestamp
        );
    }

    /**
     * @notice Check if a nullifier has been spent.
     * @param nullifier The nullifier to check
     * @return spent True if the nullifier has been spent
     */
    function isSpent(bytes32 nullifier) external view returns (bool spent) {
        return nullifiers[nullifier];
    }

    /**
     * @notice Check if a nullifier is frozen (blocked by auditor).
     * @param nullifier The nullifier to check
     * @return frozen True if the nullifier is frozen
     */
    function isFrozen(bytes32 nullifier) external view returns (bool frozen) {
        return frozenNullifiers[nullifier];
    }

    // ── Auditor Functions ─────────────────────────────────────────────────────

    /**
     * @notice Freeze a nullifier to prevent its UTXO from being spent.
     *
     * Called by auditor for compliance enforcement (sanctions, fraud, court orders).
     * A frozen nullifier cannot be submitted via submitProof.
     *
     * @param nullifier The nullifier to freeze
     * @param reason Human-readable reason for freezing (logged to event)
     *
     * STUB: Works correctly in stub mode.
     * TODO: Add Merkle proof requirement that nullifier exists in commitment tree
     */
    function freezeNullifier(
        bytes32 nullifier,
        string calldata reason
    ) external onlyAuditor {
        frozenNullifiers[nullifier] = true;

        emit NullifierFrozen(
            nullifier,
            msg.sender,
            reason,
            block.timestamp
        );
    }

    /**
     * @notice Unfreeze a nullifier (remove compliance hold).
     * @param nullifier The nullifier to unfreeze
     */
    function unfreezeNullifier(bytes32 nullifier) external onlyAuditor {
        frozenNullifiers[nullifier] = false;
    }

    // ── Admin Functions ───────────────────────────────────────────────────────

    /**
     * @notice Update the Groth16 verifier contract address.
     * Used when the circuit is updated and a new verifier is deployed.
     *
     * @param newVerifier Address of the new Groth16Verifier contract
     */
    function updateVerifier(address newVerifier) external onlyOwner {
        address old = verifier;
        verifier    = newVerifier;
        emit VerifierUpdated(old, newVerifier);
    }

    /**
     * @notice Update the auditor address.
     * @param newAuditor Address of the new auditor
     */
    function updateAuditor(address newAuditor) external onlyOwner {
        auditor = newAuditor;
    }

    /**
     * @notice Transfer ownership to a new address (multisig recommended).
     * @param newOwner Address of the new owner
     */
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}

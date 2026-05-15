// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.23;

import "./Groth16Verifier.sol";

/**
 * @title NullifierRegistry
 * @notice On-chain registry of spent nullifiers (prevents double-spending).
 *
 * ARCH: Each shielded UTXO has a unique nullifier = MiMC(secret, leaf_index).
 * When a UTXO is spent, its nullifier is revealed and stored here.
 * Any subsequent attempt to spend the same UTXO will fail.
 *
 * Security properties:
 *   - Verifier upgrades require 48-hour timelock (prevents rushed upgrades)
 *   - Two-step ownership (prevents accidental transfer to wrong address)
 *   - Pausable (emergency stop in case of discovered exploit)
 *   - All state changes emit indexed events for off-chain monitoring
 *
 * Access Control:
 *   - Anyone can call submitProof (open payment submission)
 *   - Only auditor can freeze/unfreeze nullifiers (compliance enforcement)
 *   - Owner can propose/execute verifier upgrades and pause/unpause
 *   - Owner transfer requires two steps (propose + accept)
 *
 * Deploy to testnet first; mainnet after external audit + Gnosis Safe multisig.
 */
contract NullifierRegistry {

    // ── Constants ─────────────────────────────────────────────────────────────

    uint256 public constant UPGRADE_TIMELOCK = 48 hours;

    // ── State ─────────────────────────────────────────────────────────────────

    address public owner;
    address public pendingOwner;
    address public auditor;
    address public verifier;
    address public pendingVerifier;
    uint256 public pendingVerifierExecuteAfter;
    bool    public paused;

    mapping(bytes32 => bool)         public nullifiers;
    mapping(bytes32 => bool)         public frozenNullifiers;
    mapping(bytes32 => FreezeRecord) public freezeRecords;

    struct FreezeRecord {
        address frozenBy;
        uint256 frozenAt;
        string  reason;
    }

    // ── Events ────────────────────────────────────────────────────────────────

    event PaymentConfirmed(
        bytes32 indexed nullifier,
        bytes32 indexed merkleRoot,
        address indexed caller,
        uint256 amountUnits,
        uint256 timestamp
    );
    event NullifierFrozen(
        bytes32 indexed nullifier,
        address indexed frozenBy,
        string  reason,
        uint256 timestamp
    );
    event NullifierUnfrozen(
        bytes32 indexed nullifier,
        address indexed unfrozenBy,
        uint256 timestamp
    );
    event VerifierUpgradeProposed(
        address indexed proposedVerifier,
        uint256 executeAfter,
        uint256 timestamp
    );
    event VerifierUpgradeExecuted(
        address indexed oldVerifier,
        address indexed newVerifier,
        uint256 timestamp
    );
    event VerifierUpgradeCancelled(address indexed cancelledVerifier, uint256 timestamp);
    event OwnershipTransferProposed(
        address indexed currentOwner,
        address indexed proposedOwner,
        uint256 timestamp
    );
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner,
        uint256 timestamp
    );
    event AuditorUpdated(
        address indexed previousAuditor,
        address indexed newAuditor,
        uint256 timestamp
    );
    event Paused(address indexed by, uint256 timestamp);
    event Unpaused(address indexed by, uint256 timestamp);

    // ── Errors ────────────────────────────────────────────────────────────────

    error NotOwner();
    error NotPendingOwner();
    error NotAuditor();
    error ContractPaused();
    error NullifierAlreadySpent(bytes32 nullifier);
    error NullifierIsFrozen(bytes32 nullifier);
    error ProofVerificationFailed();
    error InvalidNullifier();
    error NoUpgradePending();
    error TimelockNotExpired(uint256 executeAfter, uint256 currentTime);
    error ZeroAddress();

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _verifier, address _auditor) {
        if (_verifier == address(0)) revert ZeroAddress();
        if (_auditor  == address(0)) revert ZeroAddress();
        owner    = msg.sender;
        verifier = _verifier;
        auditor  = _auditor;
    }

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner()      { if (msg.sender != owner)   revert NotOwner();   _; }
    modifier onlyAuditor()    { if (msg.sender != auditor) revert NotAuditor(); _; }
    modifier whenNotPaused()  { if (paused) revert ContractPaused();            _; }

    // ── Core: Payment Submission ──────────────────────────────────────────────

    function submitProof(
        bytes calldata proofBytes,
        bytes32 nullifier,
        bytes32 merkleRoot,
        uint256 amountUnits
    ) external whenNotPaused {
        if (nullifier == bytes32(0))     revert InvalidNullifier();
        if (nullifiers[nullifier])       revert NullifierAlreadySpent(nullifier);
        if (frozenNullifiers[nullifier]) revert NullifierIsFrozen(nullifier);

        uint256[] memory publicInputs = new uint256[](3);
        publicInputs[0] = uint256(merkleRoot);
        publicInputs[1] = uint256(nullifier);
        publicInputs[2] = amountUnits;

        bool valid = Groth16Verifier(verifier).verifyProof(proofBytes, publicInputs);
        if (!valid) revert ProofVerificationFailed();

        nullifiers[nullifier] = true;
        emit PaymentConfirmed(nullifier, merkleRoot, msg.sender, amountUnits, block.timestamp);
    }

    // ── View Functions ────────────────────────────────────────────────────────

    function isSpent(bytes32 nullifier)  external view returns (bool) { return nullifiers[nullifier]; }
    function isFrozen(bytes32 nullifier) external view returns (bool) { return frozenNullifiers[nullifier]; }
    function isUsable(bytes32 nullifier) external view returns (bool) {
        return !nullifiers[nullifier] && !frozenNullifiers[nullifier];
    }

    // ── Auditor Functions ─────────────────────────────────────────────────────

    function freezeNullifier(bytes32 nullifier, string calldata reason) external onlyAuditor {
        frozenNullifiers[nullifier] = true;
        freezeRecords[nullifier] = FreezeRecord({ frozenBy: msg.sender, frozenAt: block.timestamp, reason: reason });
        emit NullifierFrozen(nullifier, msg.sender, reason, block.timestamp);
    }

    function unfreezeNullifier(bytes32 nullifier) external onlyAuditor {
        frozenNullifiers[nullifier] = false;
        delete freezeRecords[nullifier];
        emit NullifierUnfrozen(nullifier, msg.sender, block.timestamp);
    }

    // ── Owner: Verifier Upgrade (48h Timelock) ────────────────────────────────

    function proposeVerifierUpgrade(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert ZeroAddress();
        pendingVerifier             = newVerifier;
        pendingVerifierExecuteAfter = block.timestamp + UPGRADE_TIMELOCK;
        emit VerifierUpgradeProposed(newVerifier, pendingVerifierExecuteAfter, block.timestamp);
    }

    function executeVerifierUpgrade() external onlyOwner {
        if (pendingVerifier == address(0)) revert NoUpgradePending();
        if (block.timestamp < pendingVerifierExecuteAfter)
            revert TimelockNotExpired(pendingVerifierExecuteAfter, block.timestamp);
        address old     = verifier;
        verifier        = pendingVerifier;
        pendingVerifier = address(0);
        pendingVerifierExecuteAfter = 0;
        emit VerifierUpgradeExecuted(old, verifier, block.timestamp);
    }

    function cancelVerifierUpgrade() external onlyOwner {
        if (pendingVerifier == address(0)) revert NoUpgradePending();
        address cancelled           = pendingVerifier;
        pendingVerifier             = address(0);
        pendingVerifierExecuteAfter = 0;
        emit VerifierUpgradeCancelled(cancelled, block.timestamp);
    }

    // ── Owner: Two-Step Ownership Transfer ────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferProposed(owner, newOwner, block.timestamp);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previous = owner;
        owner        = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, owner, block.timestamp);
    }

    function updateAuditor(address newAuditor) external onlyOwner {
        if (newAuditor == address(0)) revert ZeroAddress();
        address previous = auditor;
        auditor = newAuditor;
        emit AuditorUpdated(previous, newAuditor, block.timestamp);
    }

    // ── Owner: Emergency Pause ────────────────────────────────────────────────

    function pause()   external onlyOwner { paused = true;  emit Paused(msg.sender, block.timestamp);   }
    function unpause() external onlyOwner { paused = false; emit Unpaused(msg.sender, block.timestamp); }
}

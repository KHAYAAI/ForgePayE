// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ForgeReputationRegistry} from "./ForgeReputationRegistry.sol";

/// @title ForgeTransactionValidator
/// @notice Records and validates agent transactions for on-chain Mode 2 scoring.
///         Forked from Qova/TransactionValidator — patches applied:
///         P1: `success bool` added to recordTransaction() — fixes always-100% bug
///         P6: txHash deduplication prevents double-counting
/// @dev TransactionStats feed into the Chainlink CRE workflow for Mode 2 operational scoring.
contract ForgeTransactionValidator is AccessControl, Pausable {

    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");

    enum TransactionType {
        PAYMENT,
        SWAP,
        TRANSFER,
        CONTRACT_CALL,
        BRIDGE
    }

    /// @notice Aggregate statistics per agent — feeds the CRE reputation oracle.
    struct TransactionStats {
        uint64  totalCount;             // 8 bytes
        uint128 totalVolume;            // 16 bytes — wei / stablecoin base units
        uint64  successCount;           // 8 bytes
        uint64  failCount;              // 8 bytes  — P1: now tracked separately
        uint48  lastActivityTimestamp;  // 6 bytes
    }

    ForgeReputationRegistry public immutable reputationRegistry;

    mapping(address  => TransactionStats) private _stats;
    mapping(bytes32  => bool)             private _processedTxHashes; // P6

    // ── Errors ────────────────────────────────────────────────────────────────
    error ZeroAddress();
    error ZeroAmount();
    error AmountTooLarge(uint256 amount, uint128 max);
    error TxAlreadyProcessed(bytes32 txHash);  // P6

    // ── Events ────────────────────────────────────────────────────────────────
    event TransactionRecorded(
        address indexed agent,
        bytes32 indexed txHash,
        uint256 amount,
        TransactionType txType,
        bool    success,    // P1
        uint48  timestamp
    );

    constructor(address _reputationRegistry) {
        if (_reputationRegistry == address(0)) revert ZeroAddress();
        reputationRegistry = ForgeReputationRegistry(_reputationRegistry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RECORDER_ROLE, msg.sender);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Core record function ──────────────────────────────────────────────────

    /// @notice Record a transaction for an agent, tracking success/failure separately.
    /// @param agent   The agent address.
    /// @param txHash  External transaction hash — must be unique (P6).
    /// @param amount  Transaction value in base units (must fit uint128).
    /// @param txType  Classification.
    /// @param success Whether the transaction succeeded. (P1: was always true in Qova)
    function recordTransaction(
        address         agent,
        bytes32         txHash,
        uint256         amount,
        TransactionType txType,
        bool            success          // P1: was missing in Qova — caused always-100% rate bug
    ) external onlyRole(RECORDER_ROLE) whenNotPaused {
        if (agent == address(0))              revert ZeroAddress();
        if (amount == 0)                      revert ZeroAmount();
        if (amount > type(uint128).max)       revert AmountTooLarge(amount, type(uint128).max);
        if (_processedTxHashes[txHash])       revert TxAlreadyProcessed(txHash);   // P6

        _processedTxHashes[txHash] = true;    // P6: mark before effects

        uint48 ts = uint48(block.timestamp);
        TransactionStats storage s = _stats[agent];

        unchecked {
            s.totalCount  += 1;
            s.totalVolume += uint128(amount);
            if (success) s.successCount += 1;   // P1: conditional increment
            else         s.failCount    += 1;
        }
        s.lastActivityTimestamp = ts;

        emit TransactionRecorded(agent, txHash, amount, txType, success, ts);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getTransactionStats(address agent) external view returns (TransactionStats memory) {
        return _stats[agent];
    }

    /// @notice Success rate as basis points: 9500 = 95.00%. Returns 0 if no transactions.
    function getSuccessRate(address agent) external view returns (uint256) {
        TransactionStats storage s = _stats[agent];
        if (s.totalCount == 0) return 0;
        return (uint256(s.successCount) * 10_000) / uint256(s.totalCount);
    }

    /// @notice Check if a txHash has already been recorded.
    function isProcessed(bytes32 txHash) external view returns (bool) {
        return _processedTxHashes[txHash];
    }
}

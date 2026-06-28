// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {ForgeReputationRegistry}    from "./ForgeReputationRegistry.sol";
import {ForgeTransactionValidator}  from "./ForgeTransactionValidator.sol";
import {ForgeBudgetEnforcer}        from "./ForgeBudgetEnforcer.sol";

/// @title ForgeCore
/// @notice Facade coordinating agent actions across FORGE's on-chain reputation protocol.
///         Forked from Qova/QovaCore — patches applied:
///         P5a: hasBudget cached to local bool (was called twice → 2 SLOADs)
///         P5b: 48-hour two-step timelock on sub-contract reference updates
/// @dev Follows checks-effects-interactions. Sub-contract updates require a 48h pending
///      period before they can be applied, protecting against admin key compromise.
contract ForgeCore is AccessControl, ReentrancyGuard, Pausable {

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint256 public constant UPGRADE_DELAY = 48 hours; // P5b

    // ── Sub-contracts ─────────────────────────────────────────────────────────

    ForgeReputationRegistry   public reputationRegistry;
    ForgeTransactionValidator public transactionValidator;
    ForgeBudgetEnforcer       public budgetEnforcer;

    // ── P5b: Pending upgrade queue ────────────────────────────────────────────

    struct PendingUpgrade {
        address newAddress;
        uint256 scheduledAt; // 0 means no pending upgrade
    }

    bytes32 private constant _REGISTRY_KEY   = keccak256("REGISTRY");
    bytes32 private constant _VALIDATOR_KEY  = keccak256("VALIDATOR");
    bytes32 private constant _ENFORCER_KEY   = keccak256("ENFORCER");

    mapping(bytes32 => PendingUpgrade) private _pendingUpgrades;

    // ── Errors ────────────────────────────────────────────────────────────────
    error BudgetCheckFailed();
    error InvalidContract();
    error AmountTooLarge();
    error UpgradeNotScheduled(bytes32 key);
    error UpgradeDelayNotElapsed(bytes32 key, uint256 availableAt);
    error NoPendingUpgrade(bytes32 key);

    // ── Events ────────────────────────────────────────────────────────────────
    event AgentActionExecuted(
        address indexed agent,
        bytes32 indexed txHash,
        uint256 amount,
        ForgeTransactionValidator.TransactionType txType,
        bool    success,
        uint48  timestamp
    );
    event UpgradeScheduled(bytes32 indexed key, address newAddress, uint256 availableAt); // P5b
    event UpgradeApplied(bytes32 indexed key, address oldAddress, address newAddress);     // P5b
    event UpgradeCancelled(bytes32 indexed key);                                           // P5b

    constructor(
        address _registry,
        address _validator,
        address _enforcer
    ) {
        if (_registry == address(0) || _validator == address(0) || _enforcer == address(0)) {
            revert InvalidContract();
        }
        reputationRegistry   = ForgeReputationRegistry(_registry);
        transactionValidator = ForgeTransactionValidator(_validator);
        budgetEnforcer       = ForgeBudgetEnforcer(_enforcer);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Core operation ────────────────────────────────────────────────────────

    /// @notice Execute an agent action: validate budget, record transaction, emit event.
    /// @param agent   The agent performing the action.
    /// @param txHash  External transaction hash (must be unique per ForgeTransactionValidator).
    /// @param amount  Value of the action.
    /// @param txType  Classification.
    /// @param success Whether the underlying transaction succeeded. (P1 fix propagated here)
    function executeAgentAction(
        address agent,
        bytes32 txHash,
        uint256 amount,
        ForgeTransactionValidator.TransactionType txType,
        bool    success
    ) external onlyRole(OPERATOR_ROLE) nonReentrant whenNotPaused {
        if (amount > type(uint128).max) revert AmountTooLarge();

        // P5a: cache hasBudget — was called twice in Qova causing 2 SLOADs
        bool budgetExists = budgetEnforcer.hasBudget(agent);

        // --- Checks ---
        if (budgetExists && !budgetEnforcer.checkBudget(agent, uint128(amount))) {
            revert BudgetCheckFailed();
        }

        uint48 ts = uint48(block.timestamp);

        // --- Effects ---
        emit AgentActionExecuted(agent, txHash, amount, txType, success, ts);

        // --- Interactions (trusted FORGE contracts only) ---
        if (budgetExists) {
            budgetEnforcer.recordSpend(agent, uint128(amount));
        }
        transactionValidator.recordTransaction(agent, txHash, amount, txType, success);
    }

    // ── P5b: Two-step timelocked upgrades ────────────────────────────────────

    /// @notice Step 1: Schedule a sub-contract reference update (48h delay).
    function scheduleUpgrade(bytes32 key, address newAddress)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (newAddress == address(0)) revert InvalidContract();
        if (key != _REGISTRY_KEY && key != _VALIDATOR_KEY && key != _ENFORCER_KEY) {
            revert InvalidContract();
        }
        uint256 availableAt = block.timestamp + UPGRADE_DELAY;
        _pendingUpgrades[key] = PendingUpgrade({ newAddress: newAddress, scheduledAt: block.timestamp });
        emit UpgradeScheduled(key, newAddress, availableAt);
    }

    /// @notice Step 2: Apply a scheduled upgrade after the 48h delay has elapsed.
    function applyUpgrade(bytes32 key) external onlyRole(DEFAULT_ADMIN_ROLE) {
        PendingUpgrade storage pending = _pendingUpgrades[key];
        if (pending.scheduledAt == 0)                                    revert NoPendingUpgrade(key);
        if (block.timestamp < pending.scheduledAt + UPGRADE_DELAY) {
            revert UpgradeDelayNotElapsed(key, pending.scheduledAt + UPGRADE_DELAY);
        }

        address newAddress = pending.newAddress;
        address oldAddress;

        if (key == _REGISTRY_KEY) {
            oldAddress           = address(reputationRegistry);
            reputationRegistry   = ForgeReputationRegistry(newAddress);
        } else if (key == _VALIDATOR_KEY) {
            oldAddress           = address(transactionValidator);
            transactionValidator = ForgeTransactionValidator(newAddress);
        } else {
            oldAddress           = address(budgetEnforcer);
            budgetEnforcer       = ForgeBudgetEnforcer(newAddress);
        }

        delete _pendingUpgrades[key];
        emit UpgradeApplied(key, oldAddress, newAddress);
    }

    /// @notice Cancel a scheduled upgrade before it is applied.
    function cancelUpgrade(bytes32 key) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_pendingUpgrades[key].scheduledAt == 0) revert NoPendingUpgrade(key);
        delete _pendingUpgrades[key];
        emit UpgradeCancelled(key);
    }

    function getPendingUpgrade(bytes32 key) external view returns (PendingUpgrade memory) {
        return _pendingUpgrades[key];
    }

    // ── Upgrade key constants (for callers) ───────────────────────────────────
    function REGISTRY_KEY()  external pure returns (bytes32) { return _REGISTRY_KEY; }
    function VALIDATOR_KEY() external pure returns (bytes32) { return _VALIDATOR_KEY; }
    function ENFORCER_KEY()  external pure returns (bytes32) { return _ENFORCER_KEY; }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getAgentScore(address agent)
        external view returns (uint16)
    { return reputationRegistry.getScore(agent); }

    function getAgentStats(address agent)
        external view returns (ForgeTransactionValidator.TransactionStats memory)
    { return transactionValidator.getTransactionStats(agent); }

    function getAgentBudgetStatus(address agent)
        external view returns (ForgeBudgetEnforcer.BudgetStatus memory)
    { return budgetEnforcer.getBudgetStatus(agent); }
}

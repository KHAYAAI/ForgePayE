// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ForgeBudgetEnforcer
/// @notice Enforces on-chain spending budgets (daily, monthly, per-transaction) for AI agents.
///         Forked from Qova/BudgetEnforcer — no critical patches needed.
///         Minor: zero-address guard added to setBudget().
/// @dev Lazy period resets — no cron required. Daily = 24h, Monthly = 30d rolling.
///      For regulatory calendar-month alignment use the off-chain billing-engine service.
contract ForgeBudgetEnforcer is AccessControl {

    bytes32 public constant BUDGET_MANAGER_ROLE = keccak256("BUDGET_MANAGER_ROLE");

    uint48 private constant DAILY_PERIOD   = 1 days;
    uint48 private constant MONTHLY_PERIOD = 30 days;

    struct BudgetConfig {
        uint128 dailyLimit;    // 16 bytes
        uint128 monthlyLimit;  // 16 bytes
        uint128 perTxLimit;    // 16 bytes
    }

    struct BudgetState {
        uint128 dailySpent;        // 16 bytes
        uint128 monthlySpent;      // 16 bytes
        uint48  lastDailyReset;    // 6 bytes
        uint48  lastMonthlyReset;  // 6 bytes
    }

    struct BudgetStatus {
        uint128 dailyRemaining;
        uint128 monthlyRemaining;
        uint128 perTxLimit;
        uint128 dailySpent;
        uint128 monthlySpent;
    }

    mapping(address => BudgetConfig) private _configs;
    mapping(address => BudgetState)  private _states;

    error BudgetExceeded(uint128 requested, uint128 available);
    error DailyLimitReached(uint128 requested, uint128 remaining);
    error MonthlyLimitReached(uint128 requested, uint128 remaining);
    error PerTxLimitReached(uint128 requested, uint128 limit);
    error NoBudgetSet();
    error ZeroAddress();

    event BudgetSet(address indexed agent, uint128 dailyLimit, uint128 monthlyLimit, uint128 perTxLimit);
    event SpendRecorded(address indexed agent, uint128 amount, uint128 dailyRemaining, uint128 monthlyRemaining);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(BUDGET_MANAGER_ROLE, msg.sender);
    }

    function _resetPeriods(BudgetState storage state, uint48 ts) internal {
        if (ts - state.lastDailyReset   >= DAILY_PERIOD)   { state.dailySpent   = 0; state.lastDailyReset   = ts; }
        if (ts - state.lastMonthlyReset >= MONTHLY_PERIOD) { state.monthlySpent  = 0; state.lastMonthlyReset = ts; }
    }

    function setBudget(
        address agent,
        uint128 dailyLimit,
        uint128 monthlyLimit,
        uint128 perTxLimit
    ) external onlyRole(BUDGET_MANAGER_ROLE) {
        if (agent == address(0)) revert ZeroAddress();

        _configs[agent] = BudgetConfig({ dailyLimit: dailyLimit, monthlyLimit: monthlyLimit, perTxLimit: perTxLimit });

        BudgetState storage state = _states[agent];
        if (state.lastDailyReset == 0) {
            uint48 ts = uint48(block.timestamp);
            state.lastDailyReset   = ts;
            state.lastMonthlyReset = ts;
        }

        emit BudgetSet(agent, dailyLimit, monthlyLimit, perTxLimit);
    }

    function recordSpend(address agent, uint128 amount) external onlyRole(BUDGET_MANAGER_ROLE) {
        BudgetConfig storage config = _configs[agent];
        if (config.dailyLimit == 0 && config.monthlyLimit == 0 && config.perTxLimit == 0) revert NoBudgetSet();
        if (config.perTxLimit > 0 && amount > config.perTxLimit) revert PerTxLimitReached(amount, config.perTxLimit);

        BudgetState storage state = _states[agent];
        uint48 ts = uint48(block.timestamp);
        _resetPeriods(state, ts);

        if (config.dailyLimit   > 0 && state.dailySpent   + amount > config.dailyLimit)   revert DailyLimitReached(amount,   config.dailyLimit   - state.dailySpent);
        if (config.monthlyLimit > 0 && state.monthlySpent + amount > config.monthlyLimit)  revert MonthlyLimitReached(amount, config.monthlyLimit - state.monthlySpent);

        unchecked { state.dailySpent += amount; state.monthlySpent += amount; }

        uint128 dailyRemaining   = config.dailyLimit   > state.dailySpent   ? config.dailyLimit   - state.dailySpent   : 0;
        uint128 monthlyRemaining = config.monthlyLimit > state.monthlySpent ? config.monthlyLimit - state.monthlySpent : 0;

        emit SpendRecorded(agent, amount, dailyRemaining, monthlyRemaining);
    }

    function checkBudget(address agent, uint128 amount) external view returns (bool allowed) {
        BudgetConfig storage config = _configs[agent];
        if (config.dailyLimit == 0 && config.monthlyLimit == 0 && config.perTxLimit == 0) return false;
        if (config.perTxLimit > 0 && amount > config.perTxLimit) return false;

        BudgetState storage state = _states[agent];
        uint48 ts = uint48(block.timestamp);

        uint128 effectiveDailySpent   = (ts - state.lastDailyReset   >= DAILY_PERIOD)   ? 0 : state.dailySpent;
        uint128 effectiveMonthlySpent = (ts - state.lastMonthlyReset >= MONTHLY_PERIOD) ? 0 : state.monthlySpent;

        if (config.dailyLimit   > 0 && effectiveDailySpent   + amount > config.dailyLimit)   return false;
        if (config.monthlyLimit > 0 && effectiveMonthlySpent + amount > config.monthlyLimit) return false;

        return true;
    }

    function getBudgetStatus(address agent) external view returns (BudgetStatus memory status) {
        BudgetConfig storage config = _configs[agent];
        BudgetState  storage state  = _states[agent];
        uint48 ts = uint48(block.timestamp);

        uint128 eds = (ts - state.lastDailyReset   >= DAILY_PERIOD)   ? 0 : state.dailySpent;
        uint128 ems = (ts - state.lastMonthlyReset >= MONTHLY_PERIOD) ? 0 : state.monthlySpent;

        status = BudgetStatus({
            dailyRemaining:   config.dailyLimit   > eds ? config.dailyLimit   - eds : 0,
            monthlyRemaining: config.monthlyLimit > ems ? config.monthlyLimit - ems : 0,
            perTxLimit:       config.perTxLimit,
            dailySpent:       eds,
            monthlySpent:     ems
        });
    }

    function hasBudget(address agent) external view returns (bool) {
        BudgetConfig storage config = _configs[agent];
        return config.dailyLimit > 0 || config.monthlyLimit > 0 || config.perTxLimit > 0;
    }
}

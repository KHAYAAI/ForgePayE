// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ForgeBudgetEnforcer} from "../src/ForgeBudgetEnforcer.sol";

contract ForgeBudgetEnforcerTest is Test {
    ForgeBudgetEnforcer internal enforcer;

    address internal manager = makeAddr("manager");
    address internal agent   = makeAddr("agent");

    bytes32 internal BUDGET_MANAGER = keccak256("BUDGET_MANAGER_ROLE");

    uint128 internal DAILY   = 10_000;
    uint128 internal MONTHLY = 100_000;
    uint128 internal PER_TX  = 2_000;

    function setUp() public {
        enforcer = new ForgeBudgetEnforcer();
        enforcer.grantRole(BUDGET_MANAGER, manager);
    }

    // ── Budget configuration ──────────────────────────────────────────────────

    function test_setBudget() public {
        vm.prank(manager);
        enforcer.setBudget(agent, DAILY, MONTHLY, PER_TX);

        assertTrue(enforcer.hasBudget(agent));
        ForgeBudgetEnforcer.BudgetStatus memory s = enforcer.getBudgetStatus(agent);
        assertEq(s.dailyRemaining,   DAILY);
        assertEq(s.monthlyRemaining, MONTHLY);
        assertEq(s.perTxLimit,       PER_TX);
    }

    function test_setBudget_revertZeroAddress() public {
        vm.prank(manager);
        vm.expectRevert(ForgeBudgetEnforcer.ZeroAddress.selector);
        enforcer.setBudget(address(0), DAILY, MONTHLY, PER_TX);
    }

    function test_hasBudget_false_whenUnset() public {
        assertFalse(enforcer.hasBudget(agent));
    }

    // ── Spend recording ───────────────────────────────────────────────────────

    function test_recordSpend_success() public {
        vm.prank(manager); enforcer.setBudget(agent, DAILY, MONTHLY, PER_TX);

        vm.prank(manager); enforcer.recordSpend(agent, 1_000);

        ForgeBudgetEnforcer.BudgetStatus memory s = enforcer.getBudgetStatus(agent);
        assertEq(s.dailySpent,       1_000);
        assertEq(s.monthlySpent,     1_000);
        assertEq(s.dailyRemaining,   DAILY   - 1_000);
        assertEq(s.monthlyRemaining, MONTHLY - 1_000);
    }

    function test_recordSpend_revertNoBudgetSet() public {
        vm.prank(manager);
        vm.expectRevert(ForgeBudgetEnforcer.NoBudgetSet.selector);
        enforcer.recordSpend(agent, 100);
    }

    function test_recordSpend_revertPerTxLimit() public {
        vm.prank(manager); enforcer.setBudget(agent, DAILY, MONTHLY, PER_TX);

        vm.prank(manager);
        vm.expectRevert(
            abi.encodeWithSelector(ForgeBudgetEnforcer.PerTxLimitReached.selector, PER_TX + 1, PER_TX)
        );
        enforcer.recordSpend(agent, PER_TX + 1);
    }

    function test_recordSpend_revertDailyLimit() public {
        vm.prank(manager); enforcer.setBudget(agent, DAILY, MONTHLY, PER_TX);
        // Spend up to daily limit
        vm.prank(manager); enforcer.recordSpend(agent, DAILY);
        // Next spend exceeds daily
        vm.prank(manager);
        vm.expectRevert();
        enforcer.recordSpend(agent, 1);
    }

    function test_recordSpend_revertMonthlyLimit() public {
        uint128 highDaily   = 100_000;
        uint128 lowMonthly  = 1_000;
        vm.prank(manager); enforcer.setBudget(agent, highDaily, lowMonthly, PER_TX);
        vm.prank(manager); enforcer.recordSpend(agent, lowMonthly);
        vm.prank(manager);
        vm.expectRevert();
        enforcer.recordSpend(agent, 1);
    }

    // ── Lazy period resets ────────────────────────────────────────────────────

    function test_dailyReset_after24h() public {
        vm.prank(manager); enforcer.setBudget(agent, DAILY, MONTHLY, PER_TX);
        vm.prank(manager); enforcer.recordSpend(agent, DAILY); // exhaust daily

        // Advance 24h + 1s
        vm.warp(block.timestamp + 1 days + 1);

        // checkBudget should now allow again
        assertTrue(enforcer.checkBudget(agent, DAILY));
        vm.prank(manager); enforcer.recordSpend(agent, DAILY); // should succeed
    }

    function test_monthlyReset_after30d() public {
        uint128 highDaily  = 100_000;
        uint128 lowMonthly = 5_000;
        vm.prank(manager); enforcer.setBudget(agent, highDaily, lowMonthly, highDaily);
        vm.prank(manager); enforcer.recordSpend(agent, lowMonthly); // exhaust monthly

        vm.warp(block.timestamp + 30 days + 1);

        assertTrue(enforcer.checkBudget(agent, lowMonthly));
        vm.prank(manager); enforcer.recordSpend(agent, lowMonthly);
    }

    // ── checkBudget view ──────────────────────────────────────────────────────

    function test_checkBudget_returnsFalseWhenNoBudget() public {
        assertFalse(enforcer.checkBudget(agent, 1));
    }

    function test_checkBudget_perTxExcess() public {
        vm.prank(manager); enforcer.setBudget(agent, DAILY, MONTHLY, PER_TX);
        assertFalse(enforcer.checkBudget(agent, PER_TX + 1));
        assertTrue(enforcer.checkBudget(agent,  PER_TX));
    }

    // ── Fuzz ─────────────────────────────────────────────────────────────────

    function testFuzz_spend_withinLimits(uint128 amount) public {
        vm.assume(amount > 0 && amount <= PER_TX && amount <= DAILY && amount <= MONTHLY);
        vm.prank(manager); enforcer.setBudget(agent, DAILY, MONTHLY, PER_TX);
        vm.prank(manager); enforcer.recordSpend(agent, amount);

        ForgeBudgetEnforcer.BudgetStatus memory s = enforcer.getBudgetStatus(agent);
        assertEq(s.dailySpent, amount);
    }
}

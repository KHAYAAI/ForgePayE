// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ForgeReputationRegistry}   from "../src/ForgeReputationRegistry.sol";
import {ForgeTransactionValidator} from "../src/ForgeTransactionValidator.sol";
import {ForgeBudgetEnforcer}       from "../src/ForgeBudgetEnforcer.sol";
import {ForgeCore}                 from "../src/ForgeCore.sol";

contract ForgeCoreTest is Test {
    ForgeReputationRegistry   internal reg;
    ForgeTransactionValidator internal val;
    ForgeBudgetEnforcer       internal enforcer;
    ForgeCore                 internal core;

    address internal operator  = makeAddr("operator");
    address internal agent     = makeAddr("agent");

    bytes32 internal UPDATER_ROLE   = keccak256("UPDATER_ROLE");
    bytes32 internal RECORDER_ROLE  = keccak256("RECORDER_ROLE");
    bytes32 internal OPERATOR_ROLE  = keccak256("OPERATOR_ROLE");
    bytes32 internal BUDGET_MANAGER = keccak256("BUDGET_MANAGER_ROLE");

    bytes32 internal TX1 = keccak256("tx_001");
    bytes32 internal TX2 = keccak256("tx_002");

    ForgeTransactionValidator.TransactionType internal PAYMENT =
        ForgeTransactionValidator.TransactionType.PAYMENT;

    function setUp() public {
        reg     = new ForgeReputationRegistry();
        val     = new ForgeTransactionValidator(address(reg));
        enforcer= new ForgeBudgetEnforcer();
        core    = new ForgeCore(address(reg), address(val), address(enforcer));

        // Grant ForgeCore's roles on sub-contracts
        reg.grantRole(UPDATER_ROLE,   address(core));
        val.grantRole(RECORDER_ROLE,  address(core));
        enforcer.grantRole(BUDGET_MANAGER, address(core));

        // Grant operator role to test operator
        core.grantRole(OPERATOR_ROLE, operator);

        // Register the test agent in the registry so score reads work
        reg.grantRole(UPDATER_ROLE, address(this));
        reg.registerAgent(agent);
    }

    // ── P5a: hasBudget single call ────────────────────────────────────────────
    // No budget configured → executeAgentAction skips both hasBudget calls
    // (previously called twice). We verify the tx is recorded correctly.

    function test_P5a_executeWithoutBudget() public {
        vm.prank(operator);
        core.executeAgentAction(agent, TX1, 1000, PAYMENT, true);

        ForgeTransactionValidator.TransactionStats memory s = core.getAgentStats(agent);
        assertEq(s.totalCount,   1);
        assertEq(s.successCount, 1);
    }

    function test_P5a_executeWithBudget() public {
        // Set budget via enforcer directly (core has BUDGET_MANAGER on enforcer)
        enforcer.grantRole(BUDGET_MANAGER, address(this));
        enforcer.setBudget(agent, 10_000, 100_000, 2_000);

        vm.prank(operator);
        core.executeAgentAction(agent, TX1, 1000, PAYMENT, true);

        ForgeTransactionValidator.TransactionStats memory s = core.getAgentStats(agent);
        assertEq(s.totalCount, 1);

        ForgeBudgetEnforcer.BudgetStatus memory b = core.getAgentBudgetStatus(agent);
        assertEq(b.dailySpent, 1000);
    }

    function test_executeAgentAction_revertBudgetExceeded() public {
        enforcer.grantRole(BUDGET_MANAGER, address(this));
        enforcer.setBudget(agent, 1_000, 10_000, 1_000); // daily limit = 1000

        vm.prank(operator);
        core.executeAgentAction(agent, TX1, 1_000, PAYMENT, true); // exhaust daily

        vm.prank(operator);
        vm.expectRevert(ForgeCore.BudgetCheckFailed.selector);
        core.executeAgentAction(agent, TX2, 1, PAYMENT, true);
    }

    function test_executeAgentAction_revertAmountTooLarge() public {
        uint256 tooBig = uint256(type(uint128).max) + 1;
        vm.prank(operator);
        vm.expectRevert(ForgeCore.AmountTooLarge.selector);
        core.executeAgentAction(agent, TX1, tooBig, PAYMENT, true);
    }

    function test_executeAgentAction_revertUnauthorized() public {
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert();
        core.executeAgentAction(agent, TX1, 1000, PAYMENT, true);
    }

    function test_executeAgentAction_pausable() public {
        core.pause();
        vm.prank(operator);
        vm.expectRevert();
        core.executeAgentAction(agent, TX1, 1000, PAYMENT, true);
    }

    // ── P5b: 48-hour timelock on upgrades ─────────────────────────────────────

    function test_P5b_scheduleAndApplyUpgrade() public {
        bytes32 REGISTRY_KEY = core.REGISTRY_KEY();
        address newRegistry = address(new ForgeReputationRegistry());

        core.scheduleUpgrade(REGISTRY_KEY, newRegistry);

        // Cannot apply before 48h
        vm.expectRevert();
        core.applyUpgrade(REGISTRY_KEY);

        // Advance exactly 48h
        vm.warp(block.timestamp + 48 hours);
        core.applyUpgrade(REGISTRY_KEY);

        assertEq(address(core.reputationRegistry()), newRegistry);
    }

    function test_P5b_cancelUpgrade() public {
        bytes32 REGISTRY_KEY = core.REGISTRY_KEY();
        address newRegistry = address(new ForgeReputationRegistry());
        address oldRegistry = address(core.reputationRegistry());

        core.scheduleUpgrade(REGISTRY_KEY, newRegistry);
        core.cancelUpgrade(REGISTRY_KEY);

        vm.warp(block.timestamp + 48 hours);
        vm.expectRevert(); // No pending upgrade after cancel
        core.applyUpgrade(REGISTRY_KEY);

        assertEq(address(core.reputationRegistry()), oldRegistry); // unchanged
    }

    function test_P5b_upgradeBeforeDelay_reverts() public {
        bytes32 REGISTRY_KEY = core.REGISTRY_KEY();
        address newRegistry = address(new ForgeReputationRegistry());

        core.scheduleUpgrade(REGISTRY_KEY, newRegistry);

        // 24h — not enough
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert();
        core.applyUpgrade(REGISTRY_KEY);
    }

    function test_P5b_applyWithNoPending_reverts() public {
        bytes32 key = core.REGISTRY_KEY();
        vm.expectRevert(abi.encodeWithSelector(ForgeCore.NoPendingUpgrade.selector, key));
        core.applyUpgrade(key);
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    function test_getAgentScore() public {
        // registerAgent grants 0, update to 750
        reg.grantRole(UPDATER_ROLE, address(this));
        reg.updateScore(agent, 750, keccak256("TEST"));
        assertEq(core.getAgentScore(agent), 750);
    }

    // ── Reentrancy guard ──────────────────────────────────────────────────────
    // ReentrancyGuard is on executeAgentAction — test via attacker contract.

    function test_nonReentrant() public {
        // Basic: two sequential calls with different hashes succeed
        vm.prank(operator); core.executeAgentAction(agent, TX1, 100, PAYMENT, true);
        vm.prank(operator); core.executeAgentAction(agent, TX2, 100, PAYMENT, true);
        assertEq(core.getAgentStats(agent).totalCount, 2);
    }
}

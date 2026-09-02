// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ForgeReputationRegistry} from "../src/ForgeReputationRegistry.sol";

contract ForgeReputationRegistryTest is Test {
    ForgeReputationRegistry internal reg;

    address internal admin   = address(this);
    address internal updater = makeAddr("updater");
    address internal agent1  = makeAddr("agent1");
    address internal agent2  = makeAddr("agent2");

    bytes32 internal UPDATER_ROLE = keccak256("UPDATER_ROLE");
    bytes32 internal REASON       = keccak256("TEST_REASON");

    function setUp() public {
        reg = new ForgeReputationRegistry();
        reg.grantRole(UPDATER_ROLE, updater);
    }

    // ── Registration ─────────────────────────────────────────────────────────

    function test_registerAgent() public {
        vm.prank(updater);
        reg.registerAgent(agent1);

        assertTrue(reg.isRegistered(agent1));
        assertEq(reg.getScore(agent1), 0);
        assertFalse(reg.isFrozen(agent1));
    }

    function test_registerAgent_revertZeroAddress() public {
        vm.prank(updater);
        vm.expectRevert(ForgeReputationRegistry.ZeroAddress.selector);
        reg.registerAgent(address(0));
    }

    function test_registerAgent_revertAlreadyRegistered() public {
        vm.prank(updater);
        reg.registerAgent(agent1);
        vm.prank(updater);
        vm.expectRevert(ForgeReputationRegistry.AgentAlreadyRegistered.selector);
        reg.registerAgent(agent1);
    }

    function test_registerAgent_revertUnauthorized() public {
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert();
        reg.registerAgent(agent1);
    }

    // ── Score updates ─────────────────────────────────────────────────────────

    function test_updateScore() public {
        vm.prank(updater); reg.registerAgent(agent1);

        vm.prank(updater);
        reg.updateScore(agent1, 750, REASON);
        assertEq(reg.getScore(agent1), 750);
    }

    function test_updateScore_revertInvalidScore() public {
        vm.prank(updater); reg.registerAgent(agent1);
        vm.prank(updater);
        vm.expectRevert(ForgeReputationRegistry.InvalidScore.selector);
        reg.updateScore(agent1, 1001, REASON);
    }

    function test_updateScore_revertNotRegistered() public {
        vm.prank(updater);
        vm.expectRevert(ForgeReputationRegistry.AgentNotRegistered.selector);
        reg.updateScore(agent1, 500, REASON);
    }

    function test_updateScore_revertFrozen() public {
        vm.prank(updater); reg.registerAgent(agent1);
        reg.setFrozen(agent1, true, keccak256("SANCTIONS"));

        vm.prank(updater);
        vm.expectRevert(abi.encodeWithSelector(ForgeReputationRegistry.AgentFrozen.selector, agent1));
        reg.updateScore(agent1, 500, REASON);
    }

    function test_updateScore_emitsEvent() public {
        vm.prank(updater); reg.registerAgent(agent1);
        vm.prank(updater); reg.updateScore(agent1, 600, REASON);

        vm.prank(updater);
        vm.expectEmit(true, false, false, true);
        emit ForgeReputationRegistry.ScoreUpdated(agent1, 600, 750, REASON, uint48(block.timestamp));
        reg.updateScore(agent1, 750, REASON);
    }

    // ── Batch updates ─────────────────────────────────────────────────────────

    function test_batchUpdateScores() public {
        vm.prank(updater); reg.registerAgent(agent1);
        vm.prank(updater); reg.registerAgent(agent2);

        address[] memory agents  = new address[](2);
        uint16[]  memory scores  = new uint16[](2);
        bytes32[] memory reasons = new bytes32[](2);

        agents[0] = agent1; scores[0] = 700; reasons[0] = REASON;
        agents[1] = agent2; scores[1] = 800; reasons[1] = REASON;

        vm.prank(updater);
        reg.batchUpdateScores(agents, scores, reasons);

        assertEq(reg.getScore(agent1), 700);
        assertEq(reg.getScore(agent2), 800);
    }

    function test_batchUpdateScores_revertBatchTooLarge() public {
        uint256 N = 101;
        address[] memory agents  = new address[](N);
        uint16[]  memory scores  = new uint16[](N);
        bytes32[] memory reasons = new bytes32[](N);
        for (uint256 i; i < N; i++) { agents[i] = makeAddr(vm.toString(i)); }

        vm.prank(updater);
        vm.expectRevert(ForgeReputationRegistry.BatchSizeTooLarge.selector);
        reg.batchUpdateScores(agents, scores, reasons);
    }

    function test_batchUpdateScores_revertArrayMismatch() public {
        address[] memory agents  = new address[](2);
        uint16[]  memory scores  = new uint16[](1);
        bytes32[] memory reasons = new bytes32[](2);

        vm.prank(updater);
        vm.expectRevert(ForgeReputationRegistry.ArrayLengthMismatch.selector);
        reg.batchUpdateScores(agents, scores, reasons);
    }

    // ── Compliance freeze (P4b) ───────────────────────────────────────────────

    function test_setFrozen_freeze() public {
        vm.prank(updater); reg.registerAgent(agent1);
        vm.prank(updater); reg.updateScore(agent1, 900, REASON);

        reg.setFrozen(agent1, true, keccak256("OFAC_SANCTIONS"));
        assertTrue(reg.isFrozen(agent1));
        assertEq(reg.getScore(agent1), 900); // Score still readable when frozen
    }

    function test_setFrozen_unfreeze() public {
        vm.prank(updater); reg.registerAgent(agent1);
        reg.setFrozen(agent1, true, keccak256("OFAC_SANCTIONS"));
        reg.setFrozen(agent1, false, keccak256("OFAC_CLEARED"));

        assertFalse(reg.isFrozen(agent1));
        vm.prank(updater);
        reg.updateScore(agent1, 500, REASON); // Now works again
        assertEq(reg.getScore(agent1), 500);
    }

    function test_setFrozen_revertUnauthorized() public {
        vm.prank(updater); reg.registerAgent(agent1);
        vm.prank(agent1);
        vm.expectRevert();
        reg.setFrozen(agent1, true, keccak256("HACK"));
    }

    // ── Pause ─────────────────────────────────────────────────────────────────

    function test_pause_blocksUpdates() public {
        vm.prank(updater); reg.registerAgent(agent1);
        reg.pause();

        vm.prank(updater);
        vm.expectRevert();
        reg.updateScore(agent1, 500, REASON);
    }

    function test_unpause_restoresUpdates() public {
        vm.prank(updater); reg.registerAgent(agent1);
        reg.pause();
        reg.unpause();

        vm.prank(updater);
        reg.updateScore(agent1, 500, REASON);
        assertEq(reg.getScore(agent1), 500);
    }

    // ── Fuzz ─────────────────────────────────────────────────────────────────

    function testFuzz_updateScore_validRange(uint16 score) public {
        vm.assume(score <= 1000);
        vm.prank(updater); reg.registerAgent(agent1);
        vm.prank(updater);
        reg.updateScore(agent1, score, REASON);
        assertEq(reg.getScore(agent1), score);
    }

    function testFuzz_updateScore_revertAbove1000(uint16 score) public {
        vm.assume(score > 1000);
        vm.prank(updater); reg.registerAgent(agent1);
        vm.prank(updater);
        vm.expectRevert(ForgeReputationRegistry.InvalidScore.selector);
        reg.updateScore(agent1, score, REASON);
    }
}

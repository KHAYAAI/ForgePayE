// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {ForgeReputationRegistry}   from "../src/ForgeReputationRegistry.sol";
import {ForgeTransactionValidator} from "../src/ForgeTransactionValidator.sol";

contract ForgeTransactionValidatorTest is Test {
    ForgeReputationRegistry   internal reg;
    ForgeTransactionValidator internal val;

    address internal recorder = makeAddr("recorder");
    address internal agent    = makeAddr("agent");

    bytes32 internal RECORDER_ROLE = keccak256("RECORDER_ROLE");
    bytes32 internal TX1 = keccak256("tx_hash_001");
    bytes32 internal TX2 = keccak256("tx_hash_002");
    bytes32 internal TX3 = keccak256("tx_hash_003");

    ForgeTransactionValidator.TransactionType internal PAYMENT =
        ForgeTransactionValidator.TransactionType.PAYMENT;

    function setUp() public {
        reg = new ForgeReputationRegistry();
        val = new ForgeTransactionValidator(address(reg));
        val.grantRole(RECORDER_ROLE, recorder);
    }

    // ── P1: success bool ──────────────────────────────────────────────────────
    //   Verifies that the Qova always-100% bug is fixed.
    //   successCount and failCount must now track independently.

    function test_P1_successRateTracksFailures() public {
        // Record 3 txs: 2 success, 1 fail
        vm.prank(recorder); val.recordTransaction(agent, TX1, 1000, PAYMENT, true);
        vm.prank(recorder); val.recordTransaction(agent, TX2, 1000, PAYMENT, true);
        vm.prank(recorder); val.recordTransaction(agent, TX3, 500,  PAYMENT, false);

        ForgeTransactionValidator.TransactionStats memory s = val.getTransactionStats(agent);
        assertEq(s.totalCount,   3, "totalCount mismatch");
        assertEq(s.successCount, 2, "successCount mismatch");
        assertEq(s.failCount,    1, "failCount mismatch");

        // Success rate: (2/3) * 10_000 = 6666 bps (66.66%)
        uint256 rate = val.getSuccessRate(agent);
        assertEq(rate, 6666);
        assertTrue(rate < 10_000, "P1 fix: success rate must not always be 100%");
    }

    function test_P1_allSuccessRate100() public {
        vm.prank(recorder); val.recordTransaction(agent, TX1, 1000, PAYMENT, true);
        vm.prank(recorder); val.recordTransaction(agent, TX2, 2000, PAYMENT, true);

        assertEq(val.getSuccessRate(agent), 10_000);
    }

    function test_P1_allFailSuccessRate0() public {
        vm.prank(recorder); val.recordTransaction(agent, TX1, 1000, PAYMENT, false);
        vm.prank(recorder); val.recordTransaction(agent, TX2, 1000, PAYMENT, false);

        assertEq(val.getSuccessRate(agent), 0);
    }

    function test_P1_successRateReturns0WithNoTxs() public {
        assertEq(val.getSuccessRate(agent), 0);
    }

    // ── P6: txHash deduplication ──────────────────────────────────────────────

    function test_P6_duplicateTxHashReverts() public {
        vm.prank(recorder); val.recordTransaction(agent, TX1, 1000, PAYMENT, true);

        vm.prank(recorder);
        vm.expectRevert(
            abi.encodeWithSelector(ForgeTransactionValidator.TxAlreadyProcessed.selector, TX1)
        );
        val.recordTransaction(agent, TX1, 1000, PAYMENT, true);
    }

    function test_P6_differentHashesAccepted() public {
        vm.prank(recorder); val.recordTransaction(agent, TX1, 1000, PAYMENT, true);
        vm.prank(recorder); val.recordTransaction(agent, TX2, 2000, PAYMENT, true);

        ForgeTransactionValidator.TransactionStats memory s = val.getTransactionStats(agent);
        assertEq(s.totalCount, 2);
    }

    function test_P6_isProcessedView() public {
        assertFalse(val.isProcessed(TX1));
        vm.prank(recorder); val.recordTransaction(agent, TX1, 1000, PAYMENT, true);
        assertTrue(val.isProcessed(TX1));
    }

    // ── Volume tracking ───────────────────────────────────────────────────────

    function test_volumeAccumulates() public {
        vm.prank(recorder); val.recordTransaction(agent, TX1, 1_000e18, PAYMENT, true);
        vm.prank(recorder); val.recordTransaction(agent, TX2, 500e18,   PAYMENT, true);

        ForgeTransactionValidator.TransactionStats memory s = val.getTransactionStats(agent);
        assertEq(s.totalVolume, 1_500e18);
    }

    function test_revertAmountTooLarge() public {
        uint256 tooBig = uint256(type(uint128).max) + 1;
        vm.prank(recorder);
        vm.expectRevert();
        val.recordTransaction(agent, TX1, tooBig, PAYMENT, true);
    }

    function test_revertZeroAmount() public {
        vm.prank(recorder);
        vm.expectRevert(ForgeTransactionValidator.ZeroAmount.selector);
        val.recordTransaction(agent, TX1, 0, PAYMENT, true);
    }

    function test_revertZeroAddress() public {
        vm.prank(recorder);
        vm.expectRevert(ForgeTransactionValidator.ZeroAddress.selector);
        val.recordTransaction(address(0), TX1, 1000, PAYMENT, true);
    }

    // ── Transaction types ─────────────────────────────────────────────────────

    function test_allTransactionTypes() public {
        bytes32[5] memory hashes;
        for (uint256 i; i < 5; i++) hashes[i] = keccak256(abi.encode("hash", i));

        vm.prank(recorder); val.recordTransaction(agent, hashes[0], 100, ForgeTransactionValidator.TransactionType.PAYMENT,       true);
        vm.prank(recorder); val.recordTransaction(agent, hashes[1], 100, ForgeTransactionValidator.TransactionType.SWAP,          true);
        vm.prank(recorder); val.recordTransaction(agent, hashes[2], 100, ForgeTransactionValidator.TransactionType.TRANSFER,      true);
        vm.prank(recorder); val.recordTransaction(agent, hashes[3], 100, ForgeTransactionValidator.TransactionType.CONTRACT_CALL, true);
        vm.prank(recorder); val.recordTransaction(agent, hashes[4], 100, ForgeTransactionValidator.TransactionType.BRIDGE,        true);

        assertEq(val.getTransactionStats(agent).totalCount, 5);
    }

    // ── Fuzz ─────────────────────────────────────────────────────────────────

    function testFuzz_successRate(uint8 successes, uint8 failures) public {
        vm.assume(uint256(successes) + uint256(failures) > 0);
        vm.assume(uint256(successes) + uint256(failures) <= 50); // keep test fast

        uint256 n = 0;
        for (uint8 i; i < successes; i++) {
            bytes32 h = keccak256(abi.encode("s", i));
            vm.prank(recorder); val.recordTransaction(agent, h, 1000, PAYMENT, true);
            n++;
        }
        for (uint8 i; i < failures; i++) {
            bytes32 h = keccak256(abi.encode("f", i));
            vm.prank(recorder); val.recordTransaction(agent, h, 1000, PAYMENT, false);
            n++;
        }

        uint256 expectedRate = (uint256(successes) * 10_000) / n;
        assertEq(val.getSuccessRate(agent), expectedRate);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import {ForgeReputationRegistry}   from "../src/ForgeReputationRegistry.sol";
import {ForgeTransactionValidator} from "../src/ForgeTransactionValidator.sol";
import {ForgeBudgetEnforcer}       from "../src/ForgeBudgetEnforcer.sol";
import {ForgeCore}                 from "../src/ForgeCore.sol";
import {ForgeCrossChainReputation} from "../src/ForgeCrossChainReputation.sol";

/// @notice Read-only check of who administers the FORGE stack. Broadcasts
///         nothing, changes nothing, costs no gas.
///
/// @dev TransferAdmin.s.sol performs the handover; this states what is
///      actually true afterwards. The two are separate on purpose — a script
///      that both acts and reports on itself can only tell you what it
///      intended, and the step that matters here is irreversible.
///
///      Phase 2 renounces the deployer's DEFAULT_ADMIN_ROLE. If the multisig
///      does not genuinely hold admin on all five contracts at that moment,
///      the role has no holder and no recovery path: the contracts can never
///      be re-roled, re-configured or paused again by anyone. Not a bug to fix
///      later — an unrecoverable loss of control. So run this between the
///      phases and treat a single FAIL as a stop.
///
/// Usage:
///   forge script script/VerifyAdmin.s.sol:VerifyAdmin --rpc-url base_sepolia
///
/// Required env vars:
///   ADMIN_MULTISIG_ADDRESS  — the Safe that should hold admin
///   FORGE_REGISTRY_ADDRESS, FORGE_VALIDATOR_ADDRESS, FORGE_ENFORCER_ADDRESS,
///   FORGE_CORE_ADDRESS, FORGE_CROSSCHAIN_ADDRESS
///
/// Optional:
///   DEPLOYER_ADDRESS   — the EOA that deployed. When set, its admin is
///                        reported too, which is what distinguishes
///                        "Phase 1 done" from "Phase 2 done".
///   EXPECT_PHASE       — "1" or "2". When set, the script reverts unless the
///                        on-chain state matches that phase, so it can gate a
///                        deploy pipeline rather than only inform a human.
contract VerifyAdmin is Script {
    bytes32 constant DEFAULT_ADMIN_ROLE = 0x00;

    struct Target {
        string name;
        address addr;
        bool multisigIsAdmin;
        bool deployerIsAdmin;
    }

    function run() external view {
        address multisig = vm.envAddress("ADMIN_MULTISIG_ADDRESS");
        address deployer = vm.envOr("DEPLOYER_ADDRESS", address(0));
        string memory expectPhase = vm.envOr("EXPECT_PHASE", string(""));

        console.log("=== FORGE admin role verification ===");
        console.log("Multisig:", multisig);
        if (deployer != address(0)) console.log("Deployer:", deployer);
        console.log("");

        // A multisig that is not a contract is an EOA someone typed wrong, and
        // handing admin to it is the same unrecoverable mistake as renouncing
        // early — just harder to notice.
        require(multisig != address(0), "ADMIN_MULTISIG_ADDRESS is the zero address");
        require(multisig.code.length > 0, "ADMIN_MULTISIG_ADDRESS is an EOA, not a contract");

        Target[5] memory targets = _read(multisig, deployer);

        uint256 multisigCount;
        uint256 deployerCount;

        for (uint256 i = 0; i < targets.length; i++) {
            Target memory t = targets[i];
            if (t.multisigIsAdmin) multisigCount++;
            if (t.deployerIsAdmin) deployerCount++;

            console.log(
                string.concat(
                    t.multisigIsAdmin ? "[ok]   " : "[FAIL] ",
                    t.name,
                    " @ ",
                    vm.toString(t.addr)
                )
            );
            console.log(
                string.concat(
                    "         multisig admin: ",
                    t.multisigIsAdmin ? "yes" : "NO",
                    deployer == address(0)
                        ? ""
                        : string.concat("   deployer admin: ", t.deployerIsAdmin ? "yes" : "no")
                )
            );
        }

        console.log("");
        console.log("Multisig holds admin on:", multisigCount, "of 5");
        if (deployer != address(0)) console.log("Deployer still holds admin on:", deployerCount, "of 5");
        console.log("");

        _report(multisigCount, deployerCount, deployer);
        _assertPhase(expectPhase, multisigCount, deployerCount, deployer);
    }

    /// @dev Split out purely to keep `run` under the stack-slot limit.
    function _read(address multisig, address deployer) internal view returns (Target[5] memory targets) {
        ForgeReputationRegistry   registry   = ForgeReputationRegistry(vm.envAddress("FORGE_REGISTRY_ADDRESS"));
        ForgeTransactionValidator validator  = ForgeTransactionValidator(vm.envAddress("FORGE_VALIDATOR_ADDRESS"));
        ForgeBudgetEnforcer       enforcer   = ForgeBudgetEnforcer(vm.envAddress("FORGE_ENFORCER_ADDRESS"));
        ForgeCore                 core       = ForgeCore(vm.envAddress("FORGE_CORE_ADDRESS"));
        // payable() because this contract has a payable fallback for CCIP fees.
        ForgeCrossChainReputation crossChain =
            ForgeCrossChainReputation(payable(vm.envAddress("FORGE_CROSSCHAIN_ADDRESS")));

        targets[0] = Target("ReputationRegistry",   address(registry),
            registry.hasRole(DEFAULT_ADMIN_ROLE, multisig),
            deployer != address(0) && registry.hasRole(DEFAULT_ADMIN_ROLE, deployer));
        targets[1] = Target("TransactionValidator", address(validator),
            validator.hasRole(DEFAULT_ADMIN_ROLE, multisig),
            deployer != address(0) && validator.hasRole(DEFAULT_ADMIN_ROLE, deployer));
        targets[2] = Target("BudgetEnforcer",       address(enforcer),
            enforcer.hasRole(DEFAULT_ADMIN_ROLE, multisig),
            deployer != address(0) && enforcer.hasRole(DEFAULT_ADMIN_ROLE, deployer));
        targets[3] = Target("Core",                 address(core),
            core.hasRole(DEFAULT_ADMIN_ROLE, multisig),
            deployer != address(0) && core.hasRole(DEFAULT_ADMIN_ROLE, deployer));
        targets[4] = Target("CrossChainReputation", address(crossChain),
            crossChain.hasRole(DEFAULT_ADMIN_ROLE, multisig),
            deployer != address(0) && crossChain.hasRole(DEFAULT_ADMIN_ROLE, deployer));
    }

    function _report(uint256 multisigCount, uint256 deployerCount, address deployer) internal pure {
        if (multisigCount == 0) {
            console.log("STATE: handover has not started. Run Phase 1.");
            return;
        }
        if (multisigCount < 5) {
            console.log("STATE: PARTIAL handover. Some contracts are not administered by the multisig.");
            console.log("       Do NOT run Phase 2 -- renouncing now strands the contracts still missing it.");
            return;
        }
        if (deployer == address(0)) {
            console.log("STATE: multisig administers all 5. Set DEPLOYER_ADDRESS to confirm which phase this is.");
            return;
        }
        if (deployerCount > 0) {
            console.log("STATE: Phase 1 complete. Multisig administers all 5; the deployer still does too.");
            console.log("       Before Phase 2, prove the multisig can actually sign: grant a role from it,");
            console.log("       then revoke it. A renounce against a multisig that cannot sign is final.");
        } else {
            console.log("STATE: Phase 2 complete. The multisig is the sole administrator. F-06 is closed.");
        }
    }

    /// @dev Turns the report into a gate when EXPECT_PHASE is set, so a
    ///      pipeline can fail rather than print a warning nobody reads.
    function _assertPhase(
        string memory expectPhase,
        uint256 multisigCount,
        uint256 deployerCount,
        address deployer
    ) internal pure {
        bytes32 e = keccak256(bytes(expectPhase));
        if (e == keccak256(bytes(""))) return;

        require(
            deployer != address(0),
            "EXPECT_PHASE needs DEPLOYER_ADDRESS to tell the phases apart"
        );

        if (e == keccak256(bytes("1"))) {
            require(multisigCount == 5, "Phase 1 incomplete: multisig does not administer all 5 contracts");
            require(deployerCount > 0, "Not Phase 1: the deployer has already renounced (this is Phase 2)");
        } else if (e == keccak256(bytes("2"))) {
            require(multisigCount == 5, "Refusing to call this Phase 2: multisig does not administer all 5");
            require(deployerCount == 0, "Phase 2 incomplete: the deployer still holds admin");
        } else {
            revert("EXPECT_PHASE must be 1 or 2");
        }
    }
}

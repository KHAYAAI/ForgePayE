// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import {ForgeReputationRegistry}   from "../src/ForgeReputationRegistry.sol";
import {ForgeTransactionValidator} from "../src/ForgeTransactionValidator.sol";
import {ForgeBudgetEnforcer}       from "../src/ForgeBudgetEnforcer.sol";
import {ForgeCore}                 from "../src/ForgeCore.sol";
import {ForgeCrossChainReputation} from "../src/ForgeCrossChainReputation.sol";

/// @notice Moves DEFAULT_ADMIN_ROLE from the deploying EOA to a multisig, then
///         renounces it from the EOA — the step Deploy.s.sol's own comment calls
///         for and which has not been taken.
///
/// @dev Until this runs, a single private key on one machine can pause, re-role
///      or upgrade every contract in the stack. That is tolerable on a testnet
///      and is not tolerable once the contracts hold or gate anything of value.
///
/// Run in two phases, deliberately separated:
///
///   Phase 1 — grant admin to the multisig, keep the EOA's admin:
///     forge script script/TransferAdmin.s.sol:TransferAdmin \
///       --rpc-url base_sepolia --broadcast
///
///   Verify from the multisig that it can actually administer the contracts
///   (grant a role, then revoke it). Do not skip this. A renounce against a
///   multisig that cannot sign is unrecoverable — DEFAULT_ADMIN_ROLE has no
///   other holder and no recovery path.
///
///   Phase 2 — renounce the EOA's admin, only after Phase 1 is proven:
///     RENOUNCE_DEPLOYER=true forge script script/TransferAdmin.s.sol:TransferAdmin \
///       --rpc-url base_sepolia --broadcast
///
/// Required env vars:
///   SETTLEMENT_PRIVATE_KEY  — the current admin EOA
///   ADMIN_MULTISIG_ADDRESS  — Safe (or equivalent) that will hold admin
///   FORGE_REGISTRY_ADDRESS, FORGE_VALIDATOR_ADDRESS, FORGE_ENFORCER_ADDRESS,
///   FORGE_CORE_ADDRESS, FORGE_CROSSCHAIN_ADDRESS
///   RENOUNCE_DEPLOYER       — "true" to run Phase 2. Defaults to false.
contract TransferAdmin is Script {
    bytes32 constant DEFAULT_ADMIN_ROLE = 0x00;

    function run() external {
        uint256 deployerKey = vm.envUint("SETTLEMENT_PRIVATE_KEY");
        address multisig    = vm.envAddress("ADMIN_MULTISIG_ADDRESS");
        address deployer    = vm.addr(deployerKey);

        bool renounce = vm.envOr("RENOUNCE_DEPLOYER", false);

        require(multisig != address(0),  "ADMIN_MULTISIG_ADDRESS is the zero address");
        require(multisig != deployer,    "Multisig must differ from the deployer EOA");
        require(multisig.code.length > 0, "ADMIN_MULTISIG_ADDRESS is an EOA, not a contract - a multisig is expected");

        ForgeReputationRegistry   registry   = ForgeReputationRegistry(vm.envAddress("FORGE_REGISTRY_ADDRESS"));
        ForgeTransactionValidator validator  = ForgeTransactionValidator(vm.envAddress("FORGE_VALIDATOR_ADDRESS"));
        ForgeBudgetEnforcer       enforcer   = ForgeBudgetEnforcer(vm.envAddress("FORGE_ENFORCER_ADDRESS"));
        ForgeCore                 core       = ForgeCore(vm.envAddress("FORGE_CORE_ADDRESS"));
        ForgeCrossChainReputation crossChain = ForgeCrossChainReputation(vm.envAddress("FORGE_CROSSCHAIN_ADDRESS"));

        vm.startBroadcast(deployerKey);

        if (!renounce) {
            // ── Phase 1: grant ───────────────────────────────────────────────
            registry.grantRole(DEFAULT_ADMIN_ROLE,   multisig);
            validator.grantRole(DEFAULT_ADMIN_ROLE,  multisig);
            enforcer.grantRole(DEFAULT_ADMIN_ROLE,   multisig);
            core.grantRole(DEFAULT_ADMIN_ROLE,       multisig);
            crossChain.grantRole(DEFAULT_ADMIN_ROLE, multisig);

            console.log("Phase 1 complete. DEFAULT_ADMIN_ROLE granted to:", multisig);
            console.log("Deployer still holds admin:", deployer);
            console.log("");
            console.log("NEXT: from the multisig, grant and then revoke a test role on each");
            console.log("contract to prove it can administer them. Only then run Phase 2 with");
            console.log("RENOUNCE_DEPLOYER=true. Renouncing against a multisig that cannot sign");
            console.log("leaves these contracts permanently unadministrable.");
        } else {
            // ── Phase 2: renounce ────────────────────────────────────────────
            // Confirm the multisig actually holds admin before giving ours up.
            // Without these checks a typo in ADMIN_MULTISIG_ADDRESS during Phase 1
            // would be discovered only after the last admin had been renounced.
            require(registry.hasRole(DEFAULT_ADMIN_ROLE, multisig),   "Multisig lacks admin on registry - run Phase 1 first");
            require(validator.hasRole(DEFAULT_ADMIN_ROLE, multisig),  "Multisig lacks admin on validator - run Phase 1 first");
            require(enforcer.hasRole(DEFAULT_ADMIN_ROLE, multisig),   "Multisig lacks admin on enforcer - run Phase 1 first");
            require(core.hasRole(DEFAULT_ADMIN_ROLE, multisig),       "Multisig lacks admin on core - run Phase 1 first");
            require(crossChain.hasRole(DEFAULT_ADMIN_ROLE, multisig), "Multisig lacks admin on crossChain - run Phase 1 first");

            registry.renounceRole(DEFAULT_ADMIN_ROLE,   deployer);
            validator.renounceRole(DEFAULT_ADMIN_ROLE,  deployer);
            enforcer.renounceRole(DEFAULT_ADMIN_ROLE,   deployer);
            core.renounceRole(DEFAULT_ADMIN_ROLE,       deployer);
            crossChain.renounceRole(DEFAULT_ADMIN_ROLE, deployer);

            console.log("Phase 2 complete. Deployer EOA has renounced admin on all five contracts.");
            console.log("Sole administrator is now:", multisig);
        }

        vm.stopBroadcast();
    }
}

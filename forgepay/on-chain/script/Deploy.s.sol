// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import {ForgeReputationRegistry}   from "../src/ForgeReputationRegistry.sol";
import {ForgeTransactionValidator} from "../src/ForgeTransactionValidator.sol";
import {ForgeBudgetEnforcer}       from "../src/ForgeBudgetEnforcer.sol";
import {ForgeCore}                 from "../src/ForgeCore.sol";
import {ForgeCrossChainReputation} from "../src/ForgeCrossChainReputation.sol";

/// @notice Deploys the full FORGE on-chain reputation stack.
/// @dev Run with:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $BASE_SEPOLIA_RPC_URL \
///     --private-key $SETTLEMENT_PRIVATE_KEY \
///     --broadcast --verify
///
/// Required env vars:
///   SETTLEMENT_PRIVATE_KEY   — deployer EOA (receives DEFAULT_ADMIN_ROLE on all contracts)
///   SETTLEMENT_BOT_ADDRESS   — address that will hold UPDATER_ROLE + RECORDER_ROLE
///                              (the agent-credit-bureau service's hot wallet)
///   CCIP_ROUTER_ADDRESS      — Chainlink CCIP Router for this chain
///                              Base Sepolia: 0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93
///                              Base Mainnet: 0x881e3A65B4d4a04dD529061dd0071cf975F58bCD
contract Deploy is Script {
    function run() external {
        uint256 deployerKey    = vm.envUint("SETTLEMENT_PRIVATE_KEY");
        address settlerBot     = vm.envAddress("SETTLEMENT_BOT_ADDRESS");
        address ccipRouter     = vm.envAddress("CCIP_ROUTER_ADDRESS");

        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // ── 1. Deploy core contracts ──────────────────────────────────────────

        ForgeReputationRegistry registry = new ForgeReputationRegistry();
        console.log("ForgeReputationRegistry:", address(registry));

        ForgeTransactionValidator validator = new ForgeTransactionValidator(address(registry));
        console.log("ForgeTransactionValidator:", address(validator));

        ForgeBudgetEnforcer enforcer = new ForgeBudgetEnforcer();
        console.log("ForgeBudgetEnforcer:", address(enforcer));

        ForgeCore core = new ForgeCore(address(registry), address(validator), address(enforcer));
        console.log("ForgeCore:", address(core));

        // ── 2. Deploy cross-chain contract ────────────────────────────────────

        ForgeCrossChainReputation crossChain = new ForgeCrossChainReputation(
            ccipRouter,
            address(registry)
        );
        console.log("ForgeCrossChainReputation:", address(crossChain));

        // ── 3. Grant roles to the settlement bot ──────────────────────────────
        //    (agent-credit-bureau service hot wallet)

        bytes32 UPDATER_ROLE   = keccak256("UPDATER_ROLE");
        bytes32 RECORDER_ROLE  = keccak256("RECORDER_ROLE");
        bytes32 OPERATOR_ROLE  = keccak256("OPERATOR_ROLE");
        bytes32 SENDER_ROLE    = keccak256("SENDER_ROLE");
        bytes32 BUDGET_MANAGER = keccak256("BUDGET_MANAGER_ROLE");

        registry.grantRole(UPDATER_ROLE,   settlerBot);
        validator.grantRole(RECORDER_ROLE, settlerBot);
        enforcer.grantRole(BUDGET_MANAGER, settlerBot);
        core.grantRole(OPERATOR_ROLE,      settlerBot);
        crossChain.grantRole(SENDER_ROLE,  settlerBot);

        // ── 4. Revoke deployer's operational roles (keep only DEFAULT_ADMIN) ──
        //    In production: transfer DEFAULT_ADMIN_ROLE to a multisig, then
        //    renounce from the deployer EOA.

        registry.revokeRole(UPDATER_ROLE,   deployer);
        validator.revokeRole(RECORDER_ROLE, deployer);
        enforcer.revokeRole(BUDGET_MANAGER, deployer);
        core.revokeRole(OPERATOR_ROLE,      deployer);
        crossChain.revokeRole(SENDER_ROLE,  deployer);

        vm.stopBroadcast();

        // ── 5. Print deployment summary ───────────────────────────────────────
        console.log("\n=== FORGE ON-CHAIN DEPLOYMENT SUMMARY ===");
        console.log("Chain ID:                 ", block.chainid);
        console.log("Deployer:                 ", deployer);
        console.log("Settlement Bot:           ", settlerBot);
        console.log("ForgeReputationRegistry:  ", address(registry));
        console.log("ForgeTransactionValidator:", address(validator));
        console.log("ForgeBudgetEnforcer:      ", address(enforcer));
        console.log("ForgeCore:                ", address(core));
        console.log("ForgeCrossChainReputation:", address(crossChain));
        console.log("\nAdd these to agent-credit-bureau .env:");
        console.log("FORGE_REGISTRY_ADDRESS=",  address(registry));
        console.log("FORGE_VALIDATOR_ADDRESS=", address(validator));
        console.log("FORGE_ENFORCER_ADDRESS=",  address(enforcer));
        console.log("FORGE_CORE_ADDRESS=",       address(core));
        console.log("CHAIN_ID=",                 block.chainid);
    }
}

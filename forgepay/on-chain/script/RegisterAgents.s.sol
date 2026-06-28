// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {ForgeReputationRegistry} from "../src/ForgeReputationRegistry.sol";

/// @notice Post-deploy script: batch-registers seeded agents from the
///         agent-credit-bureau in-memory store on-chain.
/// @dev Run after Deploy.s.sol:
///   forge script script/RegisterAgents.s.sol:RegisterAgents \
///     --rpc-url $BASE_SEPOLIA_RPC_URL \
///     --private-key $SETTLEMENT_PRIVATE_KEY \
///     --broadcast
///
///   Required env vars:
///     SETTLEMENT_PRIVATE_KEY
///     FORGE_REGISTRY_ADDRESS
contract RegisterAgents is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("SETTLEMENT_PRIVATE_KEY");
        address registryAddr = vm.envAddress("FORGE_REGISTRY_ADDRESS");

        ForgeReputationRegistry registry = ForgeReputationRegistry(registryAddr);

        // Seeded demo agents — addresses extracted from their DID (did:fp:0x...)
        address[] memory agents = new address[](5);
        agents[0] = 0x7a3b9C2D1e4F5A6b7C8D9e0F1A2b3c4d5E6f7A8b; // agent_prime_001
        agents[1] = 0x1a2B3C4d5e6F7a8B9c0D1e2F3a4b5c6D7e8f9a0b; // agent_prime_002
        agents[2] = 0x9F8e7d6c5b4a3928172605040302010e0f1a2b3C; // agent_subprime_001
        agents[3] = 0xDeaDbeeF1234567890AbcDef1234567890abcdef; // agent_super_001
        agents[4] = 0x0000000000000000000000000000000000000000; // agent_deep_001 — skip (zero)

        vm.startBroadcast(deployerKey);

        uint256 registered = 0;
        for (uint256 i; i < agents.length; i++) {
            if (agents[i] == address(0)) continue;
            if (!registry.isRegistered(agents[i])) {
                registry.registerAgent(agents[i]);
                console.log("Registered:", agents[i]);
                registered++;
            } else {
                console.log("Already registered:", agents[i]);
            }
        }

        vm.stopBroadcast();
        console.log("\nRegistered", registered, "agents on", block.chainid);
    }
}

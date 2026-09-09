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

        // Seeded demo agents. These are the `evmAddress` values on the bureau's
        // seed profiles (services/agent-credit-bureau/src/store.ts), which now
        // carry the address explicitly rather than encoding it in the DID.
        address[] memory agents = new address[](5);
        agents[0] = 0x7a3B9C2d1e4f5A6B7C8D9E0F1a2B3c4d5E6F7A8B; // agent_prime_001
        agents[1] = 0x1a2b3C4d5e6F7A8B9c0D1e2f3A4B5c6d7e8F9A0B; // agent_prime_002
        agents[2] = 0x9F8E7d6c5B4A3928172605040302010e0F1A2B3C; // agent_subprime_001
        agents[3] = 0xdeADbEEf1234567890AbCdeF1234567890ABCdEF; // agent_super_001
        // Was hardcoded to address(0) and skipped by the loop below — the DID
        // did:fp:0x000…dead was mis-transcribed as the zero address, so this
        // agent was silently never registered on-chain.
        agents[4] = 0x000000000000000000000000000000000000dEaD; // agent_deep_001

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

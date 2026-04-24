/**
 * Contract Verification Script — Etherscan / Blockscout
 *
 * Reads deployment record from deployments/<network>.json and submits
 * source code to the block explorer for verification.
 *
 * Usage:
 *   npx hardhat run scripts/verify.ts --network sepolia
 *
 * Prerequisites:
 *   - Deployment must exist in deployments/<network>.json
 *   - ETHERSCAN_API_KEY (or equivalent) set in environment / hardhat.config.ts
 */

import { run, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

async function verifyContract(
  address: string,
  contractName: string,
  constructorArgs: unknown[],
) {
  console.log(`\nVerifying ${contractName} at ${address}...`);
  try {
    await run('verify:verify', {
      address,
      constructorArguments: constructorArgs,
    });
    console.log(`  ✓ ${contractName} verified`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('already verified')) {
      console.log(`  ✓ ${contractName} already verified`);
    } else {
      console.error(`  ✗ ${contractName} verification failed: ${msg}`);
      throw err;
    }
  }
}

async function main() {
  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  const deploymentPath = path.join(deploymentsDir, `${network.name}.json`);

  if (!fs.existsSync(deploymentPath)) {
    throw new Error(
      `No deployment found for network '${network.name}'.\n` +
      `Run deploy first: npx hardhat run scripts/deploy.ts --network ${network.name}`,
    );
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8'));
  console.log(`\n🔍 Verifying ForgePay ZK contracts on ${network.name}`);
  console.log(`   Deployed at: ${deployment.timestamp}`);

  await verifyContract(deployment.contracts.Groth16Verifier, 'Groth16Verifier', []);

  await verifyContract(deployment.contracts.CommitmentTree, 'CommitmentTree', [
    deployment.deployer,   // owner (matches deploy.ts logic)
    deployment.updater,
  ]);

  await verifyContract(deployment.contracts.NullifierRegistry, 'NullifierRegistry', [
    deployment.contracts.Groth16Verifier,
    deployment.deployer,  // owner
    deployment.auditor,
  ]);

  console.log(`\n✅ All contracts verified on ${network.name}`);
  console.log(`   View on block explorer:`);
  const explorer = getExplorerUrl(network.name);
  if (explorer) {
    console.log(`   Groth16Verifier:   ${explorer}/address/${deployment.contracts.Groth16Verifier}`);
    console.log(`   CommitmentTree:    ${explorer}/address/${deployment.contracts.CommitmentTree}`);
    console.log(`   NullifierRegistry: ${explorer}/address/${deployment.contracts.NullifierRegistry}`);
  }
}

function getExplorerUrl(networkName: string): string | null {
  const urls: Record<string, string> = {
    sepolia: 'https://sepolia.etherscan.io',
    'polygon-mumbai': 'https://mumbai.polygonscan.com',
    'base-goerli': 'https://goerli.basescan.org',
    'arbitrum-sepolia': 'https://sepolia.arbiscan.io',
    ethereum: 'https://etherscan.io',
    polygon: 'https://polygonscan.com',
    base: 'https://basescan.org',
    arbitrum: 'https://arbiscan.io',
  };
  return urls[networkName] ?? null;
}

main().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});

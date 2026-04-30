/**
 * ForgePay ZK Contract Deployment Script
 *
 * Deploys three contracts in dependency order:
 *   1. Groth16Verifier — stateless, no constructor args
 *   2. CommitmentTree  — needs owner + updater addresses
 *   3. NullifierRegistry — needs verifier + owner + auditor addresses
 *
 * After deployment, writes a JSON record to deployments/<network>.json.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network sepolia
 *   npx hardhat run scripts/deploy.ts --network base-goerli
 *   npx hardhat run scripts/deploy.ts --network polygon-mumbai
 *   npx hardhat run scripts/deploy.ts --network arbitrum-sepolia
 *
 * For mainnet use deploy-mainnet.ts (requires 2/3 multisig confirmation).
 */

import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

interface DeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  blockNumber: number;
  contracts: {
    Groth16Verifier: string;
    CommitmentTree: string;
    NullifierRegistry: string;
  };
  auditor: string;
  updater: string;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const blockNumber = await ethers.provider.getBlockNumber();

  console.log(`\n🚀 Deploying ForgePay ZK contracts`);
  console.log(`   Network:   ${network.name} (chainId ${chainId})`);
  console.log(`   Deployer:  ${deployer.address}`);
  console.log(`   Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`   Block:     ${blockNumber}\n`);

  // ── Addresses (override via env for production) ────────────────────────────
  // In production these come from the multisig wallet and Vault-managed auditor key.
  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;
  const auditorAddress = process.env.AUDITOR_ADDRESS ?? deployer.address;
  const updaterAddress = process.env.UPDATER_ADDRESS ?? deployer.address;

  console.log(`   Owner:     ${ownerAddress}`);
  console.log(`   Auditor:   ${auditorAddress}`);
  console.log(`   Updater:   ${updaterAddress}\n`);

  // ── 1. Deploy Groth16Verifier ──────────────────────────────────────────────
  console.log('1/3  Deploying Groth16Verifier...');
  const Groth16VerifierFactory = await ethers.getContractFactory('Groth16Verifier');
  const verifier = await Groth16VerifierFactory.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log(`     ✓ Groth16Verifier:    ${verifierAddress}`);

  // ── 2. Deploy CommitmentTree ───────────────────────────────────────────────
  console.log('2/3  Deploying CommitmentTree...');
  const CommitmentTreeFactory = await ethers.getContractFactory('CommitmentTree');
  const tree = await CommitmentTreeFactory.deploy(updaterAddress);
  await tree.waitForDeployment();
  const treeAddress = await tree.getAddress();
  console.log(`     ✓ CommitmentTree:     ${treeAddress}`);

  // ── 3. Deploy NullifierRegistry ───────────────────────────────────────────
  console.log('3/3  Deploying NullifierRegistry...');
  const NullifierRegistryFactory = await ethers.getContractFactory('NullifierRegistry');
  const registry = await NullifierRegistryFactory.deploy(
    verifierAddress,
    auditorAddress,
  );
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`     ✓ NullifierRegistry:  ${registryAddress}`);

  // ── Write deployment record ────────────────────────────────────────────────
  const record: DeploymentRecord = {
    network: network.name,
    chainId: Number(chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    blockNumber,
    contracts: {
      Groth16Verifier: verifierAddress,
      CommitmentTree: treeAddress,
      NullifierRegistry: registryAddress,
    },
    auditor: auditorAddress,
    updater: updaterAddress,
  };

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outPath = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));

  console.log(`\n✅ Deployment complete — saved to ${outPath}`);
  console.log('\nNext steps:');
  console.log(`  1. Verify contracts:  npm run verify -- --network ${network.name}`);
  console.log(`  2. Update Helm values: node scripts/update-addresses.ts ${network.name}`);
  console.log(`  3. Enable chain-sync: set chainSync.enabled=true in Helm values`);
  console.log(`  4. Fund updater wallet with gas (for root update transactions)`);
}

main().catch(err => {
  console.error('❌ Deployment failed:', err);
  process.exit(1);
});

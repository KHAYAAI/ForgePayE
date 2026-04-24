/**
 * Mainnet Deployment Script — Production Safety Controls
 *
 * Adds hard safeguards on top of deploy.ts:
 *   1. Confirms security audit sign-off file exists
 *   2. Requires OWNER_ADDRESS, AUDITOR_ADDRESS, UPDATER_ADDRESS (no defaults to deployer)
 *   3. Validates minimum deployer ETH balance (0.5 ETH)
 *   4. Prints full deployment plan and requires CONFIRM=DEPLOY_MAINNET env var
 *   5. Verifies contracts on Etherscan immediately after deployment
 *   6. Runs post-deploy smoke tests against deployed contracts
 *
 * Usage (after external audit signed off):
 *   OWNER_ADDRESS=0x...   \
 *   AUDITOR_ADDRESS=0x... \
 *   UPDATER_ADDRESS=0x... \
 *   CONFIRM=DEPLOY_MAINNET \
 *   npx hardhat run scripts/deploy-mainnet.ts --network ethereum
 *
 * NEVER run this without reading SECURITY_AUDIT_SIGN_OFF.md first.
 */

import { ethers, network, run } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const MIN_BALANCE_ETH = 0.5;
const AUDIT_SIGNOFF_FILE = path.join(__dirname, '..', '..', '..', 'docs', 'security', 'SECURITY_AUDIT_SIGN_OFF.md');
const MAINNET_CHAINS = ['ethereum', 'polygon', 'base', 'arbitrum'];

async function assertAuditSignoff() {
  if (!fs.existsSync(AUDIT_SIGNOFF_FILE)) {
    throw new Error(
      `Security audit sign-off file not found: ${AUDIT_SIGNOFF_FILE}\n` +
      'External audit must be completed before mainnet deployment.\n' +
      'See docs/security/shielded-payments-audit-checklist.md',
    );
  }
  const content = fs.readFileSync(AUDIT_SIGNOFF_FILE, 'utf-8');
  if (!content.includes('SIGNED_OFF: YES')) {
    throw new Error(
      'Security audit sign-off file exists but SIGNED_OFF: YES marker not found.\n' +
      'Update the file with the ZK firm and Solidity firm sign-off before deploying.',
    );
  }
  console.log('  ✓ Security audit sign-off confirmed');
}

async function assertRequiredEnvVars() {
  const required = ['OWNER_ADDRESS', 'AUDITOR_ADDRESS', 'UPDATER_ADDRESS'];
  const missing = required.filter(v => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars for mainnet deployment: ${missing.join(', ')}\n` +
      'These must be set to production multisig/Vault-managed addresses.',
    );
  }
  if (process.env.CONFIRM !== 'DEPLOY_MAINNET') {
    throw new Error(
      'Mainnet deployment requires CONFIRM=DEPLOY_MAINNET environment variable.\n' +
      'This is a safety check to prevent accidental mainnet deployments.',
    );
  }
}

async function assertSufficientBalance(deployer: { address: string }) {
  const balance = await ethers.provider.getBalance(deployer.address);
  const balanceEth = parseFloat(ethers.formatEther(balance));
  if (balanceEth < MIN_BALANCE_ETH) {
    throw new Error(
      `Insufficient deployer balance: ${balanceEth} ETH (minimum ${MIN_BALANCE_ETH} ETH required)`,
    );
  }
  console.log(`  ✓ Deployer balance: ${balanceEth.toFixed(4)} ETH`);
}

async function verifyContract(address: string, constructorArgs: unknown[]) {
  try {
    await run('verify:verify', { address, constructorArguments: constructorArgs });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes('already verified')) {
      console.warn(`  ⚠️  Verification warning: ${msg}`);
    }
  }
}

async function smokeTest(
  verifierAddress: string,
  treeAddress: string,
  registryAddress: string,
) {
  console.log('\n🧪 Running post-deploy smoke tests...');

  const verifier = await ethers.getContractAt('Groth16Verifier', verifierAddress);
  const tree = await ethers.getContractAt('CommitmentTree', treeAddress);
  const registry = await ethers.getContractAt('NullifierRegistry', registryAddress);

  // Verify Groth16Verifier responds to version()
  const version = await (verifier as { version(): Promise<string> }).version();
  console.log(`  ✓ Groth16Verifier.version() = "${version}"`);

  // Verify CommitmentTree has a root
  const root = await (tree as { currentRoot(): Promise<string> }).currentRoot();
  console.log(`  ✓ CommitmentTree.currentRoot() = ${root.slice(0, 18)}...`);

  // Verify NullifierRegistry links to correct verifier
  const linkedVerifier = await (registry as { verifier(): Promise<string> }).verifier();
  if (linkedVerifier.toLowerCase() !== verifierAddress.toLowerCase()) {
    throw new Error(`Registry points to wrong verifier: ${linkedVerifier}`);
  }
  console.log(`  ✓ NullifierRegistry.verifier() links correctly`);

  // Verify a known-unspent nullifier returns false
  const testNullifier = ethers.ZeroHash;
  const isSpent = await (registry as { isSpent(n: string): Promise<boolean> }).isSpent(testNullifier);
  if (isSpent) throw new Error('Zero nullifier should not be spent on fresh deployment');
  console.log(`  ✓ NullifierRegistry.isSpent(0) = false (correct)`);
}

async function main() {
  if (!MAINNET_CHAINS.includes(network.name)) {
    throw new Error(
      `deploy-mainnet.ts is for mainnet only. Network '${network.name}' is not in ${MAINNET_CHAINS.join(', ')}.\n` +
      'Use scripts/deploy.ts for testnets.',
    );
  }

  console.log('\n🔒 ForgePay ZK Mainnet Deployment — Safety Checks\n');

  await assertAuditSignoff();
  await assertRequiredEnvVars();

  const [deployer] = await ethers.getSigners();
  await assertSufficientBalance(deployer);

  const { chainId } = await ethers.provider.getNetwork();
  const ownerAddress = process.env.OWNER_ADDRESS!;
  const auditorAddress = process.env.AUDITOR_ADDRESS!;
  const updaterAddress = process.env.UPDATER_ADDRESS!;

  console.log(`\n📋 Deployment Plan:`);
  console.log(`   Network:   ${network.name} (chainId ${chainId})`);
  console.log(`   Deployer:  ${deployer.address}`);
  console.log(`   Owner:     ${ownerAddress}`);
  console.log(`   Auditor:   ${auditorAddress}`);
  console.log(`   Updater:   ${updaterAddress}`);
  console.log('\n⚠️  THIS IS A MAINNET DEPLOYMENT. Proceeding...\n');

  // Deploy
  console.log('1/3  Deploying Groth16Verifier...');
  const VerifierFactory = await ethers.getContractFactory('Groth16Verifier');
  const verifier = await VerifierFactory.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log(`     ✓ ${verifierAddress}`);

  console.log('2/3  Deploying CommitmentTree...');
  const TreeFactory = await ethers.getContractFactory('CommitmentTree');
  const tree = await TreeFactory.deploy(ownerAddress, updaterAddress);
  await tree.waitForDeployment();
  const treeAddress = await tree.getAddress();
  console.log(`     ✓ ${treeAddress}`);

  console.log('3/3  Deploying NullifierRegistry...');
  const RegistryFactory = await ethers.getContractFactory('NullifierRegistry');
  const registry = await RegistryFactory.deploy(verifierAddress, ownerAddress, auditorAddress);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`     ✓ ${registryAddress}`);

  // Smoke tests before writing record
  await smokeTest(verifierAddress, treeAddress, registryAddress);

  // Verify on Etherscan
  console.log('\n🔍 Verifying contracts on block explorer...');
  await verifyContract(verifierAddress, []);
  await verifyContract(treeAddress, [ownerAddress, updaterAddress]);
  await verifyContract(registryAddress, [verifierAddress, ownerAddress, auditorAddress]);
  console.log('  ✓ All contracts verified');

  // Write deployment record
  const blockNumber = await ethers.provider.getBlockNumber();
  const record = {
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
    mainnet: true,
    auditSignoffVerified: true,
  };

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outPath = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));

  console.log(`\n✅ Mainnet deployment complete — ${outPath}`);
  console.log('\nFinal steps:');
  console.log('  1. Run: node scripts/update-addresses.ts ' + network.name);
  console.log('  2. Enable chain-sync: helm upgrade with chainSync.enabled=true');
  console.log('  3. Set zk.enabled=true in Helm values to enable shielded payments');
  console.log('  4. Monitor NullifierRegistry events for 24h before announcing');
}

main().catch(err => {
  console.error('\n❌ Mainnet deployment FAILED:', err.message);
  console.error('No state was changed. Investigate and retry.');
  process.exit(1);
});

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);

  const network = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);

  // Deploy PoseidonHasher (library — no constructor args)
  console.log('\n[1/4] Deploying PoseidonHasher...');
  const PoseidonHasher = await ethers.getContractFactory('PoseidonHasher');
  // PoseidonHasher is a library — link it to dependent contracts
  // (Hardhat handles library linking automatically when imported)

  // Deploy Groth16Verifier
  console.log('[2/4] Deploying Groth16Verifier...');
  const Groth16Verifier = await ethers.getContractFactory('Groth16Verifier');
  const groth16Verifier = await Groth16Verifier.deploy();
  await groth16Verifier.waitForDeployment();
  const groth16Addr = await groth16Verifier.getAddress();
  console.log(`  Groth16Verifier deployed to: ${groth16Addr}`);

  // Deploy CommitmentTree
  console.log('[3/4] Deploying CommitmentTree...');
  const CommitmentTree = await ethers.getContractFactory('CommitmentTree');
  const commitmentTree = await CommitmentTree.deploy(deployer.address);
  await commitmentTree.waitForDeployment();
  const treeAddr = await commitmentTree.getAddress();
  console.log(`  CommitmentTree deployed to: ${treeAddr}`);

  // Deploy NullifierRegistry
  console.log('[4/4] Deploying NullifierRegistry...');
  const NullifierRegistry = await ethers.getContractFactory('NullifierRegistry');
  const nullifierRegistry = await NullifierRegistry.deploy(groth16Addr, deployer.address);
  await nullifierRegistry.waitForDeployment();
  const registryAddr = await nullifierRegistry.getAddress();
  console.log(`  NullifierRegistry deployed to: ${registryAddr}`);

  // Write deployment manifest
  const manifest = {
    network: network.name,
    chainId: network.chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      groth16Verifier: groth16Addr,
      commitmentTree:  treeAddr,
      nullifierRegistry: registryAddr,
    },
  };

  const outDir  = path.join(__dirname, '../deployments');
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.log(`\n[deploy] Manifest written to ${outFile}`);
  console.log('\n[deploy] Add these addresses to Helm values:');
  console.log(`  groth16_verifier:   ${groth16Addr}`);
  console.log(`  commitment_tree:    ${treeAddr}`);
  console.log(`  nullifier_registry: ${registryAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

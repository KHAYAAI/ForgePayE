/**
 * Update Helm Values with Deployed Contract Addresses
 *
 * Reads deployment records from deployments/ and patches the corresponding
 * Helm values files with real contract addresses.
 *
 * Usage:
 *   node -r ts-node/register scripts/update-addresses.ts [--all | <network>]
 *
 * Example:
 *   node -r ts-node/register scripts/update-addresses.ts sepolia
 *   node -r ts-node/register scripts/update-addresses.ts --all
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Map Hardhat network names to Helm chain keys
const NETWORK_TO_CHAIN: Record<string, string> = {
  sepolia: 'ethereum',
  ethereum: 'ethereum',
  'polygon-mumbai': 'polygon',
  polygon: 'polygon',
  'base-goerli': 'base',
  base: 'base',
  'arbitrum-sepolia': 'arbitrum',
  arbitrum: 'arbitrum',
};

const HELM_CHAIN_SYNC_VALUES = path.join(
  __dirname, '..', '..', 'helm', 'chain-sync', 'values.yaml',
);
const HELM_STACK_VALUES = path.join(
  __dirname, '..', '..', 'helm', 'forgepay-stack', 'values.yaml',
);

function loadDeployment(networkName: string): Record<string, unknown> | null {
  const p = path.join(__dirname, '..', 'deployments', `${networkName}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function patchYamlFile(filePath: string, patcher: (doc: Record<string, unknown>) => void) {
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠️  Helm values not found: ${filePath}`);
    return;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const doc = yaml.load(content) as Record<string, unknown>;
  patcher(doc);
  fs.writeFileSync(filePath, yaml.dump(doc, { lineWidth: 120 }));
  console.log(`  ✓ Patched ${path.relative(process.cwd(), filePath)}`);
}

function updateChainSyncValues(deployment: Record<string, unknown>, chainKey: string) {
  patchYamlFile(HELM_CHAIN_SYNC_VALUES, (doc) => {
    const contracts = (doc as Record<string, Record<string, Record<string, Record<string, string>>>>);
    if (!contracts.contracts) contracts.contracts = {} as Record<string, Record<string, Record<string, string>>>;
    if (!contracts.contracts.nullifierRegistry) contracts.contracts.nullifierRegistry = {} as Record<string, Record<string, string>>;
    if (!contracts.contracts.commitmentTree) contracts.contracts.commitmentTree = {} as Record<string, Record<string, string>>;
    if (!contracts.contracts.groth16Verifier) contracts.contracts.groth16Verifier = {} as Record<string, Record<string, string>>;

    const c = (deployment as { contracts: { NullifierRegistry: string; CommitmentTree: string; Groth16Verifier: string } }).contracts;
    (contracts.contracts.nullifierRegistry as Record<string, string>)[chainKey] = c.NullifierRegistry;
    (contracts.contracts.commitmentTree as Record<string, string>)[chainKey] = c.CommitmentTree;
    (contracts.contracts.groth16Verifier as Record<string, string>)[chainKey] = c.Groth16Verifier;
  });
}

function updateStackValues(deployment: Record<string, unknown>, chainKey: string) {
  patchYamlFile(HELM_STACK_VALUES, (doc) => {
    const d = doc as {
      zk?: { contracts?: { nullifierRegistry?: Record<string, string>; commitmentTree?: Record<string, string>; groth16Verifier?: Record<string, string> } };
      chainSync?: { contracts?: { nullifierRegistry?: Record<string, string>; commitmentTree?: Record<string, string> } };
    };
    const c = (deployment as { contracts: { NullifierRegistry: string; CommitmentTree: string; Groth16Verifier: string } }).contracts;

    if (d.zk?.contracts) {
      if (!d.zk.contracts.nullifierRegistry) d.zk.contracts.nullifierRegistry = {};
      if (!d.zk.contracts.commitmentTree) d.zk.contracts.commitmentTree = {};
      if (!d.zk.contracts.groth16Verifier) d.zk.contracts.groth16Verifier = {};
      d.zk.contracts.nullifierRegistry[chainKey] = c.NullifierRegistry;
      d.zk.contracts.commitmentTree[chainKey] = c.CommitmentTree;
      d.zk.contracts.groth16Verifier[chainKey] = c.Groth16Verifier;
    }
    if (d.chainSync?.contracts) {
      if (!d.chainSync.contracts.nullifierRegistry) d.chainSync.contracts.nullifierRegistry = {};
      if (!d.chainSync.contracts.commitmentTree) d.chainSync.contracts.commitmentTree = {};
      d.chainSync.contracts.nullifierRegistry[chainKey] = c.NullifierRegistry;
      d.chainSync.contracts.commitmentTree[chainKey] = c.CommitmentTree;
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  const updateAll = args.includes('--all');
  const networkNames = updateAll
    ? Object.keys(NETWORK_TO_CHAIN)
    : args.filter(a => !a.startsWith('--'));

  if (networkNames.length === 0) {
    console.error('Usage: node scripts/update-addresses.ts [--all | <network>]');
    process.exit(1);
  }

  let updated = 0;
  for (const networkName of networkNames) {
    const deployment = loadDeployment(networkName);
    if (!deployment) {
      console.log(`⏭  No deployment found for ${networkName}, skipping`);
      continue;
    }

    const chainKey = NETWORK_TO_CHAIN[networkName];
    if (!chainKey) {
      console.warn(`⚠️  Unknown network mapping for '${networkName}', skipping`);
      continue;
    }

    console.log(`\n📝 Updating addresses for ${networkName} → ${chainKey}`);
    updateChainSyncValues(deployment, chainKey);
    updateStackValues(deployment, chainKey);
    updated++;
  }

  if (updated === 0) {
    console.log('\nNo deployments found. Deploy first:');
    console.log('  npx hardhat run scripts/deploy.ts --network <network>');
  } else {
    console.log(`\n✅ Updated ${updated} network(s) in Helm values`);
    console.log('\nNext: helm upgrade forgepay-stack ./helm/forgepay-stack');
  }
}

main().catch(err => {
  console.error('❌ Update failed:', err);
  process.exit(1);
});

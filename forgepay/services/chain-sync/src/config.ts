/**
 * Chain Sync configuration — loaded from environment variables.
 *
 * All RPC URLs and contract addresses are injected from Kubernetes secrets.
 * Never hardcode these values.
 */

export interface ChainConfig {
  rpcUrl:                 string;
  nullifierRegistryAddr:  string;
  commitmentTreeAddr:     string;
  groth16VerifierAddr:    string;
  confirmations:          number;
}

export interface Config {
  port:                 number;
  nodeEnv:              string;
  databaseUrl:          string;
  unifiedRouterUrl:     string;
  internalWebhookSecret: string;
  pollIntervalMs:       number;
  chains:               Record<string, ChainConfig>;
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config: Config = {
  port:                  parseInt(optEnv('PORT', '8050'), 10),
  nodeEnv:               optEnv('NODE_ENV', 'development'),
  databaseUrl:           requireEnv('DATABASE_URL'),
  unifiedRouterUrl:      optEnv('UNIFIED_ROUTER_URL', 'http://unified-router:8000'),
  internalWebhookSecret: requireEnv('INTERNAL_WEBHOOK_SECRET'),
  pollIntervalMs:        parseInt(optEnv('POLL_INTERVAL_MS', '12000'), 10),

  chains: {
    ethereum: {
      rpcUrl:                optEnv('ETHEREUM_RPC_URL', ''),
      nullifierRegistryAddr: optEnv('ETHEREUM_NULLIFIER_REGISTRY_ADDR', '0x0000000000000000000000000000000000000000'),
      commitmentTreeAddr:    optEnv('ETHEREUM_COMMITMENT_TREE_ADDR',    '0x0000000000000000000000000000000000000000'),
      groth16VerifierAddr:   optEnv('ETHEREUM_GROTH16_VERIFIER_ADDR',   '0x0000000000000000000000000000000000000000'),
      confirmations: 12,
    },
    polygon: {
      rpcUrl:                optEnv('POLYGON_RPC_URL', ''),
      nullifierRegistryAddr: optEnv('POLYGON_NULLIFIER_REGISTRY_ADDR',  '0x0000000000000000000000000000000000000000'),
      commitmentTreeAddr:    optEnv('POLYGON_COMMITMENT_TREE_ADDR',      '0x0000000000000000000000000000000000000000'),
      groth16VerifierAddr:   optEnv('POLYGON_GROTH16_VERIFIER_ADDR',     '0x0000000000000000000000000000000000000000'),
      confirmations: 32,
    },
    base: {
      rpcUrl:                optEnv('BASE_RPC_URL', ''),
      nullifierRegistryAddr: optEnv('BASE_NULLIFIER_REGISTRY_ADDR',     '0x0000000000000000000000000000000000000000'),
      commitmentTreeAddr:    optEnv('BASE_COMMITMENT_TREE_ADDR',         '0x0000000000000000000000000000000000000000'),
      groth16VerifierAddr:   optEnv('BASE_GROTH16_VERIFIER_ADDR',        '0x0000000000000000000000000000000000000000'),
      confirmations: 10,
    },
    arbitrum: {
      rpcUrl:                optEnv('ARBITRUM_RPC_URL', ''),
      nullifierRegistryAddr: optEnv('ARBITRUM_NULLIFIER_REGISTRY_ADDR', '0x0000000000000000000000000000000000000000'),
      commitmentTreeAddr:    optEnv('ARBITRUM_COMMITMENT_TREE_ADDR',     '0x0000000000000000000000000000000000000000'),
      groth16VerifierAddr:   optEnv('ARBITRUM_GROTH16_VERIFIER_ADDR',    '0x0000000000000000000000000000000000000000'),
      confirmations: 10,
    },
  },
};

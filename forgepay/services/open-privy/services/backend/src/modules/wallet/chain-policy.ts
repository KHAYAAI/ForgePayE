/**
 * Which EVM chains the wallet may sign for. Testnet only unless mainnet is
 * enabled on purpose (WALLET_MAINNET_ENABLED=true): Ethereum Sepolia,
 * Polygon Amoy, Base Sepolia.
 */
export const EVM_TESTNET_CHAIN_IDS = new Set<bigint>([11155111n, 80002n, 84532n]);

export function evmChainAllowed(chainId: bigint, env: NodeJS.ProcessEnv = process.env): boolean {
  return EVM_TESTNET_CHAIN_IDS.has(chainId) || env.WALLET_MAINNET_ENABLED === 'true';
}

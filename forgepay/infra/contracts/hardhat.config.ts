import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

const config: HardhatUserConfig = {
  paths: {
    sources: './contracts', // Symlinks to .sol files at project root
  },
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    // Testnet networks (RPC URLs from env)
    sepolia: {
      url:     process.env.ETHEREUM_TESTNET_RPC_URL ?? '',
      accounts: process.env.DEPLOY_PRIVATE_KEY ? [process.env.DEPLOY_PRIVATE_KEY] : [],
    },
    polygonMumbai: {
      url:     process.env.POLYGON_TESTNET_RPC_URL ?? '',
      accounts: process.env.DEPLOY_PRIVATE_KEY ? [process.env.DEPLOY_PRIVATE_KEY] : [],
    },
    baseGoerli: {
      url:     process.env.BASE_TESTNET_RPC_URL ?? '',
      accounts: process.env.DEPLOY_PRIVATE_KEY ? [process.env.DEPLOY_PRIVATE_KEY] : [],
    },
    arbitrumSepolia: {
      url:     process.env.ARBITRUM_TESTNET_RPC_URL ?? '',
      accounts: process.env.DEPLOY_PRIVATE_KEY ? [process.env.DEPLOY_PRIVATE_KEY] : [],
    },
    // Mainnet networks (RPC URLs from env)
    ethereum: {
      url:     process.env.ETHEREUM_MAINNET_RPC_URL ?? '',
      accounts: process.env.DEPLOY_PRIVATE_KEY ? [process.env.DEPLOY_PRIVATE_KEY] : [],
    },
    polygon: {
      url:     process.env.POLYGON_MAINNET_RPC_URL ?? '',
      accounts: process.env.DEPLOY_PRIVATE_KEY ? [process.env.DEPLOY_PRIVATE_KEY] : [],
    },
    base: {
      url:     process.env.BASE_MAINNET_RPC_URL ?? '',
      accounts: process.env.DEPLOY_PRIVATE_KEY ? [process.env.DEPLOY_PRIVATE_KEY] : [],
    },
    arbitrum: {
      url:     process.env.ARBITRUM_MAINNET_RPC_URL ?? '',
      accounts: process.env.DEPLOY_PRIVATE_KEY ? [process.env.DEPLOY_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      mainnet:         process.env.ETHERSCAN_API_KEY ?? '',
      polygon:         process.env.POLYGONSCAN_API_KEY ?? '',
      base:            process.env.BASESCAN_API_KEY ?? '',
      arbitrumOne:     process.env.ARBISCAN_API_KEY ?? '',
    },
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
};

export default config;

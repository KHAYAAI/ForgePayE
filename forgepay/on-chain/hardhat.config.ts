import type { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
    },
  },
  paths: {
    sources:   './src',
    tests:     './test-hh',
    cache:     './cache-hh',
    artifacts: './artifacts',
  },
  networks: {
    hardhat: {},
    baseSepolia: {
      url:      process.env['BASE_SEPOLIA_RPC_URL'] ?? '',
      accounts: process.env['SETTLEMENT_PRIVATE_KEY']
        ? [process.env['SETTLEMENT_PRIVATE_KEY']]
        : [],
      chainId:  84532,
    },
    base: {
      url:      process.env['BASE_MAINNET_RPC_URL'] ?? '',
      accounts: process.env['SETTLEMENT_PRIVATE_KEY']
        ? [process.env['SETTLEMENT_PRIVATE_KEY']]
        : [],
      chainId:  8453,
    },
  },
};

export default config;

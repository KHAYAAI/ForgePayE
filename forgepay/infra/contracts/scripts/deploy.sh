#!/usr/bin/env bash
# Deploy ForgePay ZK contracts to a target network.
# Usage: ./deploy.sh <network>
# Networks: localhost | goerli | sepolia | polygon-mumbai | base-goerli | mainnet | polygon | base | arbitrum

set -euo pipefail

NETWORK="${1:-localhost}"
CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[deploy] Deploying ForgePay ZK contracts to network: $NETWORK"

cd "$CONTRACTS_DIR"

# Verify required env vars for non-local deployments
if [[ "$NETWORK" != "localhost" ]]; then
  : "${DEPLOYER_PRIVATE_KEY:?Required: DEPLOYER_PRIVATE_KEY}"
  : "${RPC_URL:?Required: RPC_URL}"
fi

# Compile contracts
echo "[deploy] Compiling contracts..."
npx hardhat compile

# Deploy
echo "[deploy] Running deployment..."
NETWORK="$NETWORK" npx hardhat run scripts/deploy-contracts.ts --network "$NETWORK"

echo "[deploy] Done. Update Helm values with the deployed addresses."
echo "[deploy] For mainnet, update forgepay/infra/helm/forgepay-stack/values-mainnet.yaml"

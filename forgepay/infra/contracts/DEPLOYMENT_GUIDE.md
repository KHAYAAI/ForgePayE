# ForgePay Smart Contract Deployment Guide

This guide covers deploying the four core ForgePay ZK contracts to Sepolia and Base Sepolia testnets.

## Contracts

1. **Groth16Verifier.sol** — Verifies ZK proofs (BN254 pairings)
2. **NullifierRegistry.sol** — Tracks spent nullifiers (prevents double-spending)
3. **CommitmentTree.sol** — Merkle tree for UTXO commitments
4. **PoseidonHasher.sol** — Hash library (no separate deployment needed)

## Prerequisites

- Node.js 18+ and npm
- Hardhat installed (`npm install`)
- Test ETH on Sepolia (~0.5 ETH for gas)
- RPC endpoints:
  - Infura: https://sepolia.infura.io/v3/{YOUR_INFURA_KEY}
  - Alchemy: https://eth-sepolia.g.alchemy.com/v2/{YOUR_ALCHEMY_KEY}

## Deployment Steps

### 1. Set Up Environment

Create `.env.local` or `.env.sepolia` with:

```bash
ETHEREUM_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
DEPLOY_PRIVATE_KEY=0x[your_test_wallet_private_key]
ETHERSCAN_API_KEY=[optional, for contract verification]
```

**IMPORTANT:** Never commit private keys to git. Use `.env.local` or external secret management.

### 2. Verify Compilation

```bash
cd forgepay/infra/contracts
npm install
npx hardhat compile
```

Expected output: All 4 contracts compile successfully.

### 3. Deploy to Sepolia

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

This deploys:
1. **Groth16Verifier** (no constructor args)
2. **CommitmentTree** (requires updater address)
3. **NullifierRegistry** (requires verifier + auditor address)

Expected output: Three contract addresses (0x...).

### 4. Record Addresses

The deployment script automatically saves addresses to `deployments/sepolia.json`:

```json
{
  "network": "sepolia",
  "chainId": 11155111,
  "deployer": "0x...",
  "timestamp": "2026-04-30T...",
  "blockNumber": 123456,
  "contracts": {
    "Groth16Verifier": "0x...",
    "CommitmentTree": "0x...",
    "NullifierRegistry": "0x..."
  },
  "auditor": "0x...",
  "updater": "0x..."
}
```

### 5. Verify on Etherscan (Optional)

```bash
npx hardhat run scripts/verify.ts --network sepolia
```

This requires `ETHERSCAN_API_KEY` in `.env` and contracts must be verified within 24 hours of deployment.

### 6. Update ForgePay Configuration

Update `forgepay/config/environments/dev.yaml`:

```yaml
contracts:
  groth16Verifier:
    sepolia: "0x[deployed_address]"
  nullifierRegistry:
    sepolia: "0x[deployed_address]"
  commitmentTree:
    sepolia: "0x[deployed_address]"
```

### 7. Update Helm Values

Update `forgepay/infra/helm/stablecoin-gateway/values.yaml`:

```yaml
shielded:
  enabled: false  # Keep false until Phase 2
  nullifierRegistry:
    ethereum: "0x[sepolia_address]"
```

### 8. Commit Changes

```bash
git add forgepay/infra/contracts/scripts/deploy.ts
git add forgepay/config/environments/dev.yaml
git add forgepay/infra/helm/stablecoin-gateway/values.yaml
git add deployments/sepolia.json

git commit -m "infra(contracts): deploy Groth16Verifier, NullifierRegistry, CommitmentTree to Sepolia testnet"
```

## Deployment to Base Sepolia

To deploy to Base Sepolia, update `hardhat.config.ts` to add:

```typescript
baseSepolia: {
  url: process.env.BASE_TESTNET_RPC_URL ?? '',
  accounts: process.env.DEPLOY_PRIVATE_KEY ? [process.env.DEPLOY_PRIVATE_KEY] : [],
}
```

Then run:

```bash
export BASE_TESTNET_RPC_URL=https://sepolia.base.org
npx hardhat run scripts/deploy.ts --network baseSepolia
```

## Constructor Arguments

### Groth16Verifier
- No constructor arguments
- Starts in `stubMode=true` (all proofs accepted for testing)
- Call `setStubMode(false)` after verifying keys are injected

### CommitmentTree
- `_updater` (address) — unified-router service account

### NullifierRegistry
- `_verifier` (address) — Groth16Verifier contract address
- `_auditor` (address) — auditor key for compliance enforcement

### PoseidonHasher
- Library only (deployed as part of CommitmentTree)

## Testing Proofs

For development, the Groth16Verifier starts in stub mode:

```solidity
bool stubMode = true;
```

This bypasses pairing checks. To test real proofs:

1. Generate ZK proof using `auditable-privacy-payment` circuit
2. Call `setStubMode(false)` on Groth16Verifier
3. Inject verifying keys via `setVerifyingKey()`
4. Submit proof via `NullifierRegistry.submitProof()`

## Troubleshooting

### Contract Compilation Fails
- Ensure Solidity 0.8.23: `pragma solidity ^0.8.23;`
- Check import paths are relative: `import "./PoseidonHasher.sol";`

### Deployment Fails with "insufficient funds"
- Check wallet has enough ETH: `npm run balance -- --network sepolia`
- Request more testnet ETH from faucet

### Verification Fails
- Wait 24 hours after deployment before verifying
- Check `ETHERSCAN_API_KEY` is valid
- Ensure bytecode matches (recompile if needed)

### Wrong Constructor Arguments
- CommitmentTree requires only `_updater`
- NullifierRegistry requires `_verifier` and `_auditor`
- See contract source in root directory

## Mainnet Deployment

For production (Ethereum mainnet, Polygon, Base, Arbitrum):

1. Use `scripts/deploy-mainnet.ts` (requires 2/3 multisig)
2. Store deployment record in `deployments/ethereum.json`
3. Deploy to all chains before enabling shielded payments
4. Perform external security audit before moving to prod

## References

- [EIP-1962: EC arithmetic precompiles](https://eips.ethereum.org/EIPS/eip-1962)
- [Groth16 specification](https://eprint.iacr.org/2016/260.pdf)
- [Poseidon hash paper](https://eprint.iacr.org/2019/458.pdf)
- [ForgePay Architecture](../../../FORGEPAY.md)

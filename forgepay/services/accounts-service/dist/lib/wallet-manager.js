import { ethers } from 'ethers';
import { KMSClient, CreateKeyCommand, GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';
import { encryptPrivateKey, decryptPrivateKey } from './keystore.js';
import { config } from '../config.js';
const CHAIN_IDS = {
    ethereum: 1,
    polygon: 137,
    base: 8453,
    arbitrum: 42161,
};
export class WalletManager {
    kmsClient;
    constructor() {
        this.kmsClient = new KMSClient({ region: config.aws.region || 'us-east-1' });
    }
    async generateWallet(chain = config.accounts.defaultChain, accountType = 'self_custodial') {
        if (accountType === 'custodial') {
            return this.generateCustodialWallet(chain);
        }
        else {
            return this.generateSelfCustodialWallet(chain);
        }
    }
    async generateSelfCustodialWallet(chain) {
        const wallet = ethers.Wallet.createRandom();
        return {
            address: wallet.address,
            chain,
            accountType: 'self_custodial',
            encryptedKey: encryptPrivateKey(wallet.privateKey),
        };
    }
    async generateCustodialWallet(chain) {
        // Create ECC_SECG_P256K1 key in AWS KMS (secp256k1 for EVM)
        const createKeyCmd = new CreateKeyCommand({
            KeyUsage: 'SIGN_VERIFY',
            KeySpec: 'ECC_SECG_P256K1',
            Description: `ForgePay custodial wallet for ${chain}`,
        });
        const keyResp = await this.kmsClient.send(createKeyCmd);
        const keyId = keyResp.KeyMetadata?.KeyId;
        if (!keyId)
            throw new Error('Failed to create KMS key');
        // Get public key to derive Ethereum address
        const pubKeyCmd = new GetPublicKeyCommand({ KeyId: keyId });
        const pubKeyResp = await this.kmsClient.send(pubKeyCmd);
        const publicKeyBytes = new Uint8Array(pubKeyResp.PublicKey);
        // Derive address from uncompressed public key (skip first byte for ECC)
        const pubKeyHex = Buffer.from(publicKeyBytes).toString('hex');
        const uncompressed = pubKeyHex.slice(2); // Remove curve identifier
        const addressHash = ethers.keccak256('0x' + uncompressed);
        const address = '0x' + addressHash.slice(-40);
        return {
            address,
            chain,
            accountType: 'custodial',
            kmsKeyId: keyId,
        };
    }
    async getPrivateKey(encryptedKey) {
        return decryptPrivateKey(encryptedKey);
    }
    async getSigner(encryptedKey, chain) {
        const privateKey = decryptPrivateKey(encryptedKey);
        const provider = this.getProvider(chain);
        return new ethers.Wallet(privateKey, provider);
    }
    async signWithCustodialKey(kmsKeyId, txHash) {
        const signCmd = new SignCommand({
            KeyId: kmsKeyId,
            Message: new TextEncoder().encode(txHash),
            SigningAlgorithm: 'ECDSA_SHA_256',
        });
        const signResp = await this.kmsClient.send(signCmd);
        return Buffer.from(signResp.Signature).toString('hex');
    }
    getProvider(chain) {
        const rpcUrls = {
            ethereum: config.rpc.ethereum,
            polygon: config.rpc.polygon,
            base: config.rpc.base,
            arbitrum: config.rpc.arbitrum,
        };
        const url = rpcUrls[chain];
        if (!url)
            throw new Error(`Unsupported chain: ${chain}`);
        const chainId = CHAIN_IDS[chain];
        return new ethers.JsonRpcProvider(url, chainId ? { chainId, name: chain } : undefined);
    }
}
//# sourceMappingURL=wallet-manager.js.map
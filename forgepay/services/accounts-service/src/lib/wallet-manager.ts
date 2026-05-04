import { ethers } from 'ethers';
import { KMSClient, CreateKeyCommand, GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';
import { encryptPrivateKey, decryptPrivateKey } from './keystore.js';
import { config } from '../config.js';

export interface WalletInfo {
  address:      string;
  chain:        string;
  encryptedKey?: string;  // null for custodial
  kmsKeyId?:    string;   // null for self_custodial
  accountType:  'custodial' | 'self_custodial';
}

const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  polygon:  137,
  base:     8453,
  arbitrum: 42161,
};

export class WalletManager {
  private kmsClient: KMSClient;

  constructor() {
    this.kmsClient = new KMSClient({ region: config.aws.region || 'us-east-1' });
  }

  async generateWallet(
    chain: string = config.accounts.defaultChain,
    accountType: 'custodial' | 'self_custodial' = 'self_custodial'
  ): Promise<WalletInfo> {
    if (accountType === 'custodial') {
      return this.generateCustodialWallet(chain);
    } else {
      return this.generateSelfCustodialWallet(chain);
    }
  }

  private async generateSelfCustodialWallet(chain: string): Promise<WalletInfo> {
    const wallet = ethers.Wallet.createRandom();
    return {
      address:      wallet.address,
      chain,
      accountType:  'self_custodial',
      encryptedKey: encryptPrivateKey(wallet.privateKey),
    };
  }

  private async generateCustodialWallet(chain: string): Promise<WalletInfo> {
    // Create ECC_SECG_P256K1 key in AWS KMS (secp256k1 for EVM)
    const createKeyCmd = new CreateKeyCommand({
      KeyUsage: 'SIGN_VERIFY',
      KeySpec: 'ECC_SECG_P256K1',
      Description: `ForgePay custodial wallet for ${chain}`,
    });
    const keyResp = await this.kmsClient.send(createKeyCmd);
    const keyId = keyResp.KeyMetadata?.KeyId;
    if (!keyId) throw new Error('Failed to create KMS key');

    // Get public key to derive Ethereum address
    const pubKeyCmd = new GetPublicKeyCommand({ KeyId: keyId });
    const pubKeyResp = await this.kmsClient.send(pubKeyCmd);
    const publicKeyBytes = new Uint8Array(pubKeyResp.PublicKey!);

    // Derive address from uncompressed public key (skip first byte for ECC)
    const pubKeyHex = Buffer.from(publicKeyBytes).toString('hex');
    const uncompressed = pubKeyHex.slice(2); // Remove curve identifier
    const addressHash = ethers.keccak256('0x' + uncompressed);
    const address = '0x' + addressHash.slice(-40);

    return {
      address,
      chain,
      accountType: 'custodial',
      kmsKeyId:    keyId,
    };
  }

  async getPrivateKey(encryptedKey: string): Promise<string> {
    return decryptPrivateKey(encryptedKey);
  }

  async getSigner(encryptedKey: string, chain: string): Promise<ethers.Wallet> {
    const privateKey = decryptPrivateKey(encryptedKey);
    const provider   = this.getProvider(chain);
    return new ethers.Wallet(privateKey, provider);
  }

  async signWithCustodialKey(kmsKeyId: string, txHash: string): Promise<string> {
    const signCmd = new SignCommand({
      KeyId: kmsKeyId,
      Message: new TextEncoder().encode(txHash),
      SigningAlgorithm: 'ECDSA_SHA_256',
    });
    const signResp = await this.kmsClient.send(signCmd);
    return Buffer.from(signResp.Signature!).toString('hex');
  }

  getProvider(chain: string): ethers.JsonRpcProvider {
    const rpcUrls: Record<string, string> = {
      ethereum: config.rpc.ethereum,
      polygon:  config.rpc.polygon,
      base:     config.rpc.base,
      arbitrum: config.rpc.arbitrum,
    };
    const url = rpcUrls[chain];
    if (!url) throw new Error(`Unsupported chain: ${chain}`);
    const chainId = CHAIN_IDS[chain];
    return new ethers.JsonRpcProvider(url, chainId ? { chainId, name: chain } : undefined);
  }
}

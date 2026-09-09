import { ethers } from 'ethers';
export interface WalletInfo {
    address: string;
    chain: string;
    encryptedKey?: string;
    kmsKeyId?: string;
    accountType: 'custodial' | 'self_custodial';
}
export declare class WalletManager {
    private kmsClient;
    constructor();
    generateWallet(chain?: string, accountType?: 'custodial' | 'self_custodial'): Promise<WalletInfo>;
    private generateSelfCustodialWallet;
    private generateCustodialWallet;
    getPrivateKey(encryptedKey: string): Promise<string>;
    getSigner(encryptedKey: string, chain: string): Promise<ethers.Wallet>;
    signWithCustodialKey(kmsKeyId: string, txHash: string): Promise<string>;
    getProvider(chain: string): ethers.JsonRpcProvider;
}
//# sourceMappingURL=wallet-manager.d.ts.map
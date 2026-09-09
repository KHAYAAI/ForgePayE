import { WalletManager } from './wallet-manager.js';
export interface TransferResult {
    txHash: string;
    blockNumber?: number;
}
export declare class BlockchainManager {
    private readonly wallets;
    constructor(wallets: WalletManager);
    getBalance(address: string, token: 'USDC' | 'USDT', chain: string): Promise<string>;
    transfer(fromEncryptedKey: string, toAddress: string, amountUnits: bigint, token: 'USDC' | 'USDT', chain: string): Promise<TransferResult>;
    getContractAddress(token: 'USDC' | 'USDT', chain: string): string;
}
//# sourceMappingURL=blockchain-manager.d.ts.map
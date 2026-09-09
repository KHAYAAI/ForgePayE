import type { Pool } from 'pg';
import type { CircleClient } from './circle-client.js';
import type { WalletManager } from './wallet-manager.js';
export interface DepositRequest {
    accountId: string;
    merchantId: string;
    amountUsd: number;
    chain?: string;
}
export interface DepositRecord {
    id: string;
    accountId: string;
    merchantId: string;
    amountUsd: number;
    amountUnits: string;
    chain: string;
    depositAddress: string;
    circleIntentId?: string;
    status: 'pending' | 'processing' | 'confirmed' | 'failed';
    txHash?: string;
    createdAt: string;
    confirmedAt?: string;
    expiresAt: string;
}
export declare class DepositManager {
    private readonly db;
    private readonly circle;
    private readonly wallets;
    constructor(db: Pool, circle: CircleClient, wallets: WalletManager);
    createDeposit(req: DepositRequest): Promise<DepositRecord>;
    checkDepositStatus(depositId: string): Promise<DepositRecord>;
    confirmDirectDeposit(depositId: string, txHash: string): Promise<DepositRecord>;
}
//# sourceMappingURL=deposit-manager.d.ts.map
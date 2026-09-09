import type { Pool } from 'pg';
import type { CircleClient, WireDetails } from './circle-client.js';
export interface WithdrawalRequest {
    accountId: string;
    merchantId: string;
    amountUsd: number;
    wireDetails: WireDetails;
}
export interface WithdrawalRecord {
    id: string;
    accountId: string;
    merchantId: string;
    amountUsd: number;
    feeUsd: number;
    netAmountUsd: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    circlePayoutId?: string;
    createdAt: string;
    completedAt?: string;
}
export declare class WithdrawalManager {
    private readonly db;
    private readonly circle;
    constructor(db: Pool, circle: CircleClient);
    initiateWithdrawal(req: WithdrawalRequest): Promise<WithdrawalRecord>;
    checkWithdrawalStatus(withdrawalId: string): Promise<WithdrawalRecord>;
}
//# sourceMappingURL=withdrawal-manager.d.ts.map
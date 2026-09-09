import type { Pool } from 'pg';
import type { FraudDetectionManager } from './fraud-detection-manager.js';
import type { RoutingManager, RouteDecision } from './routing-manager.js';
import type { ZkProofManager } from './zk-proof-manager.js';
export type TransactionType = 'deposit' | 'withdrawal' | 'internal_transfer';
export type TransactionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'blocked';
export declare class TransactionBlockedError extends Error {
    readonly transactionId: string;
    readonly riskScore: number;
    readonly riskFactors: string[];
    constructor(transactionId: string, riskScore: number, riskFactors: string[]);
}
export interface TransactionRecord {
    id: string;
    accountId: string;
    merchantId: string;
    type: TransactionType;
    amountUsd: number;
    amountUnits: string;
    token: 'USDC' | 'USDT';
    chain: string;
    status: TransactionStatus;
    riskScore?: number;
    fraudDecision?: 'allow' | 'review' | 'block';
    zkProof?: string;
    commitment?: string;
    txHash?: string;
    depositId?: string;
    withdrawalId?: string;
    routeInfo?: RouteDecision;
    errorMessage?: string;
    createdAt: string;
    completedAt?: string;
}
export interface CreateTransactionRequest {
    accountId: string;
    merchantId: string;
    type: TransactionType;
    amountUsd: number;
    chain?: string;
    token?: 'USDC' | 'USDT';
    destinationAddress?: string;
    metadata?: Record<string, unknown>;
}
export declare class TransactionManager {
    private readonly db;
    private readonly fraudDetection;
    private readonly routing;
    private readonly zkProofs;
    constructor(db: Pool, fraudDetection: FraudDetectionManager, routing: RoutingManager, zkProofs: ZkProofManager);
    createTransaction(req: CreateTransactionRequest): Promise<TransactionRecord>;
    getTransaction(txId: string): Promise<TransactionRecord | null>;
    listTransactions(accountId: string, limit?: number): Promise<TransactionRecord[]>;
    updateStatus(txId: string, status: TransactionStatus, txHash?: string): Promise<void>;
}
//# sourceMappingURL=transaction-manager.d.ts.map
/**
 * Bank White-Label Module — Core Type Definitions
 *
 * These types model the multi-tenant bank isolation layer.
 * Each Bank is a fully isolated tenant; BankCustomers belong to exactly one Bank.
 * BankAdmins are scoped by bankId and can only view/modify their own bank's data.
 */
export interface Bank {
    id: string;
    name: string;
    slug: string;
    logoUrl?: string;
    primaryColor?: string;
    customDomain?: string;
    webhookUrl?: string;
    webhookFormat: 'forgepay' | 'iso20022' | 'custom';
    webhookSigningKey?: string;
    kycInherited: boolean;
    amlLevel: 'inherited' | 'standard' | 'enhanced';
    settlementCurrency: string;
    settlementSchedule: 'daily' | 'weekly';
    createdAt: string;
    status: 'active' | 'suspended' | 'pending';
    adminEmails: string[];
}
export interface BankAdmin {
    id: string;
    bankId: string;
    email: string;
    passwordHash: string;
    role: 'super_admin' | 'admin' | 'viewer';
    createdAt: string;
    lastLoginAt?: string;
}
export interface BankCustomer {
    id: string;
    bankId: string;
    bankCustomerRef: string;
    email?: string;
    phone?: string;
    kycStatus: 'inherited' | 'pending' | 'approved' | 'rejected';
    kycInheritedFrom?: string;
    riskLevel: 'low' | 'medium' | 'high';
    dailyLimitUsd: number;
    totalVolumeUsd: number;
    transactionCount: number;
    createdAt: string;
    status: 'active' | 'suspended';
}
export interface BankTransaction {
    id: string;
    bankId: string;
    customerId: string;
    type: 'crypto_purchase' | 'crypto_sale' | 'stablecoin_deposit' | 'stablecoin_withdrawal';
    asset: string;
    amountCrypto: number;
    amountUsd: number;
    feeUsd: number;
    netAmountUsd: number;
    status: 'pending' | 'confirmed' | 'failed' | 'refunded';
    txHash?: string;
    createdAt: string;
    confirmedAt?: string;
}
export interface SettlementReport {
    bankId: string;
    bankName: string;
    reportDate: string;
    currency: string;
    totalTransactions: number;
    totalVolumeUsd: number;
    totalFeesUsd: number;
    netSettlementUsd: number;
    transactions: BankTransaction[];
    generatedAt: string;
}
export interface JwtPayload {
    adminId: string;
    bankId: string;
    role: BankAdmin['role'];
}
//# sourceMappingURL=types.d.ts.map
export type AccountEventType = 'account.created' | 'account.kyc.submitted' | 'account.kyc.approved' | 'account.kyc.rejected' | 'account.deposit.initiated' | 'account.deposit.confirmed' | 'account.deposit.failed' | 'account.withdrawal.initiated' | 'account.withdrawal.confirmed' | 'account.withdrawal.failed' | 'account.transfer.completed' | 'account.fraud.blocked';
export interface AccountEvent {
    eventId: string;
    type: AccountEventType;
    merchantId: string;
    accountId: string;
    data: Record<string, unknown>;
    occurredAt: string;
}
export declare function buildEvent(type: AccountEventType, merchantId: string, accountId: string, data: Record<string, unknown>): AccountEvent;
export declare function forwardToUnifiedRouter(event: AccountEvent): Promise<void>;
//# sourceMappingURL=events.d.ts.map
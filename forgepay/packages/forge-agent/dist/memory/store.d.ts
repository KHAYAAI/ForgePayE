export interface MemoryEntry {
    id: string;
    merchantId: string;
    key: string;
    value: string;
    createdAt: string;
    updatedAt: string;
}
export interface SessionSummary {
    id: string;
    merchantId: string;
    summary: string;
    createdAt: string;
}
export interface MemoryStore {
    recall(merchantId: string): Promise<string>;
    store(merchantId: string, key: string, value: string): Promise<void>;
    getEntry(merchantId: string, key: string): Promise<string | undefined>;
    appendSessionSummary(merchantId: string, summary: string): Promise<void>;
    getRecentSummaries(merchantId: string, n: number): Promise<SessionSummary[]>;
    close(): void;
}
//# sourceMappingURL=store.d.ts.map
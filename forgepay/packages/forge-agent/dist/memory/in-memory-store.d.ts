import type { MemoryStore, SessionSummary } from "./store";
export declare class InMemoryStore implements MemoryStore {
    private entries;
    private summaries;
    recall(merchantId: string): Promise<string>;
    store(merchantId: string, key: string, value: string): Promise<void>;
    getEntry(merchantId: string, key: string): Promise<string | undefined>;
    appendSessionSummary(merchantId: string, summary: string): Promise<void>;
    getRecentSummaries(merchantId: string, n: number): Promise<SessionSummary[]>;
    close(): void;
}
//# sourceMappingURL=in-memory-store.d.ts.map
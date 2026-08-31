import type { MemoryStore, SessionSummary } from "./store";
export declare class FileStore implements MemoryStore {
    private baseDir;
    private cache;
    constructor(baseDir?: string);
    private merchantFilePath;
    private loadMerchant;
    private saveMerchant;
    recall(merchantId: string): Promise<string>;
    store(merchantId: string, key: string, value: string): Promise<void>;
    getEntry(merchantId: string, key: string): Promise<string | undefined>;
    appendSessionSummary(merchantId: string, summary: string): Promise<void>;
    getRecentSummaries(merchantId: string, n: number): Promise<SessionSummary[]>;
    close(): void;
}
//# sourceMappingURL=file-store.d.ts.map
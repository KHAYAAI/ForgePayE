"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryStore = void 0;
const crypto_1 = require("crypto");
const MAX_SUMMARIES = 10;
const RECENT_SUMMARIES_IN_RECALL = 3;
class InMemoryStore {
    constructor() {
        this.entries = new Map();
        this.summaries = new Map();
    }
    async recall(merchantId) {
        const parts = [];
        const merchantEntries = this.entries.get(merchantId) ?? [];
        for (const entry of merchantEntries) {
            parts.push(`${entry.key}: ${entry.value}`);
        }
        const recentSummaries = await this.getRecentSummaries(merchantId, RECENT_SUMMARIES_IN_RECALL);
        for (const s of recentSummaries) {
            parts.push(`Previous session: ${s.summary}`);
        }
        return parts.join("\n");
    }
    async store(merchantId, key, value) {
        const now = new Date().toISOString();
        const merchantEntries = this.entries.get(merchantId) ?? [];
        const existingIndex = merchantEntries.findIndex(e => e.key === key);
        if (existingIndex !== -1) {
            merchantEntries[existingIndex] = {
                ...merchantEntries[existingIndex],
                value,
                updatedAt: now,
            };
        }
        else {
            merchantEntries.push({
                id: (0, crypto_1.randomUUID)(),
                merchantId,
                key,
                value,
                createdAt: now,
                updatedAt: now,
            });
        }
        this.entries.set(merchantId, merchantEntries);
    }
    async getEntry(merchantId, key) {
        return this.entries.get(merchantId)?.find(e => e.key === key)?.value;
    }
    async appendSessionSummary(merchantId, summary) {
        const now = new Date().toISOString();
        const existing = this.summaries.get(merchantId) ?? [];
        existing.push({
            id: (0, crypto_1.randomUUID)(),
            merchantId,
            summary,
            createdAt: now,
        });
        // Keep only the most recent MAX_SUMMARIES entries
        if (existing.length > MAX_SUMMARIES) {
            existing.splice(0, existing.length - MAX_SUMMARIES);
        }
        this.summaries.set(merchantId, existing);
    }
    async getRecentSummaries(merchantId, n) {
        const all = this.summaries.get(merchantId) ?? [];
        // Return the last n items in reverse-chronological order (most recent first)
        return all.slice(-n).reverse();
    }
    close() {
        // No-op for in-memory implementation
    }
}
exports.InMemoryStore = InMemoryStore;
//# sourceMappingURL=in-memory-store.js.map
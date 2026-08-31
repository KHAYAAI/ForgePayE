"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileStore = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const crypto_1 = require("crypto");
const MAX_SUMMARIES = 20;
const RECENT_SUMMARIES_IN_RECALL = 3;
class FileStore {
    constructor(baseDir) {
        // In-memory cache keyed by merchantId → StorageFile
        // Populated lazily on first access, written through on every mutation
        this.cache = new Map();
        this.baseDir = baseDir ?? (0, path_1.join)((0, os_1.homedir)(), ".forgepay", "agent");
    }
    merchantFilePath(merchantId) {
        // Sanitize merchantId for use as filename (replace non-alphanumeric with _)
        const safe = merchantId.replace(/[^a-zA-Z0-9_-]/g, "_");
        return (0, path_1.join)(this.baseDir, `${safe}.json`);
    }
    async loadMerchant(merchantId) {
        if (this.cache.has(merchantId))
            return this.cache.get(merchantId);
        const path = this.merchantFilePath(merchantId);
        try {
            const raw = await fs_1.promises.readFile(path, "utf-8");
            const data = JSON.parse(raw);
            this.cache.set(merchantId, data);
            return data;
        }
        catch {
            // File doesn't exist yet — start fresh
            const empty = { entries: [], summaries: [] };
            this.cache.set(merchantId, empty);
            return empty;
        }
    }
    async saveMerchant(merchantId, data) {
        const path = this.merchantFilePath(merchantId);
        await fs_1.promises.mkdir((0, path_1.dirname)(path), { recursive: true });
        await fs_1.promises.writeFile(path, JSON.stringify(data, null, 2), "utf-8");
        this.cache.set(merchantId, data);
    }
    async recall(merchantId) {
        const data = await this.loadMerchant(merchantId);
        const lines = [];
        // Format key-value entries
        if (data.entries.length > 0) {
            lines.push("Stored merchant context:");
            for (const e of data.entries) {
                lines.push(`  ${e.key}: ${e.value}`);
            }
        }
        // Format last N session summaries (most recent first)
        const recent = [...data.summaries].reverse().slice(0, RECENT_SUMMARIES_IN_RECALL);
        if (recent.length > 0) {
            lines.push("Recent session history:");
            for (const s of recent) {
                lines.push(`  [${s.createdAt.slice(0, 10)}] ${s.summary}`);
            }
        }
        return lines.join("\n");
    }
    async store(merchantId, key, value) {
        const data = await this.loadMerchant(merchantId);
        const now = new Date().toISOString();
        const existing = data.entries.find(e => e.key === key);
        if (existing) {
            existing.value = value;
            existing.updatedAt = now;
        }
        else {
            data.entries.push({
                id: (0, crypto_1.randomUUID)(),
                merchantId,
                key,
                value,
                createdAt: now,
                updatedAt: now,
            });
        }
        await this.saveMerchant(merchantId, data);
    }
    async getEntry(merchantId, key) {
        const data = await this.loadMerchant(merchantId);
        return data.entries.find(e => e.key === key)?.value;
    }
    async appendSessionSummary(merchantId, summary) {
        const data = await this.loadMerchant(merchantId);
        data.summaries.push({
            id: (0, crypto_1.randomUUID)(),
            merchantId,
            summary,
            createdAt: new Date().toISOString(),
        });
        // Keep last MAX_SUMMARIES summaries
        if (data.summaries.length > MAX_SUMMARIES) {
            data.summaries = data.summaries.slice(-MAX_SUMMARIES);
        }
        await this.saveMerchant(merchantId, data);
    }
    async getRecentSummaries(merchantId, n) {
        const data = await this.loadMerchant(merchantId);
        return [...data.summaries].reverse().slice(0, n);
    }
    close() {
        this.cache.clear();
    }
}
exports.FileStore = FileStore;
//# sourceMappingURL=file-store.js.map